import {
  buildPublicationData,
  buildReviewBrief,
  countryFlag,
  countryName,
  moderationCategory,
  type ModerationContext,
  type ModerationSubmission,
} from "../lib/moderation";
import {
  categories,
  subcategoryLabel,
} from "../lib/taxonomy";

type QueueName =
  "pending" | "flagged" | "approved" | "rejected" | "published" | "reports";
type DialogElement = HTMLDialogElement & { showModal(): void };

const element = <T extends HTMLElement>(selector: string): T => {
  const match = document.querySelector<T>(selector);
  if (!match) throw new Error(`Missing moderation element: ${selector}`);
  return match;
};

const workspace = element<HTMLElement>("#review-workspace");
const reportsView = element<HTMLElement>("#reports-view");
const archiveView = element<HTMLElement>("#archive-view");
const queueState = element<HTMLElement>("#queue-state");
const actionBar = element<HTMLElement>("#review-actions");
const card = element<HTMLElement>("#review-card");
const overlay = element<HTMLElement>("#swipe-overlay");
const announcer = element<HTMLElement>("#announcer");
const tooltip = element<HTMLElement>("#country-tooltip");

let activeQueue: QueueName = "pending";
let submissions: ModerationSubmission[] = [];
let position = 0;
let currentContext: ModerationContext = {};
let moderatorRole: "reviewer" | "admin" = "reviewer";
let undoTarget: string | null = null;
let undoTimer: number | undefined;
let publicationTimer: number | undefined;

interface PublicationBatch {
  id: string;
  status: "preparing" | "validating" | "merging" | "published" | "failed";
  item_count: number;
  github_pr_url: string | null;
  last_error_code: string | null;
  deployment_requested_at: string | null;
}

const categoryFilter = element<HTMLSelectElement>("#moderation-category-filter");

const text = (selector: string, value: string | number | null | undefined) => {
  element(selector).textContent =
    value === null || value === undefined || value === ""
      ? "Not provided"
      : String(value);
};
const current = (): ModerationSubmission | null =>
  submissions[position] ?? null;
const titleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);
const show = (node: HTMLElement, visible: boolean) => {
  node.hidden = !visible;
  node.classList.toggle("hidden", !visible);
};

const renderPills = (selector: string, values: string[]) => {
  const container = element(selector);
  container.replaceChildren();
  if (!values.length) {
    container.textContent = "None";
    return;
  }
  values.forEach((value) => {
    const tag = document.createElement("span");
    tag.className = "rounded bg-soft px-2 py-1 text-xs font-medium";
    tag.textContent = value;
    container.append(tag);
  });
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (response.status === 401) {
    location.assign(
      `/moderator-login/?next=${encodeURIComponent(location.pathname)}`,
    );
    throw new Error("Authentication required");
  }
  const payload = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok)
    throw new Error(payload.error?.message ?? "The moderation request failed.");
  return payload;
}

function setLoading(message = "Loading submissions...") {
  queueState.textContent = message;
  show(queueState, true);
  show(workspace, false);
  show(reportsView, false);
  show(archiveView, false);
  show(actionBar, false);
}

function setQueueLabels(count: number) {
  element("#queue-name").textContent = titleCase(activeQueue);
  element("#queue-count").textContent =
    `${count} ${activeQueue === "reports" ? "reports" : "submissions"}`;
  element("#queue-position").textContent =
    count && (activeQueue === "pending" || activeQueue === "flagged")
      ? `${position + 1} of ${count}`
      : "";
  document
    .querySelectorAll<HTMLButtonElement>("[data-queue]")
    .forEach((button) => {
      const selected = button.dataset.queue === activeQueue;
      button.setAttribute("aria-selected", String(selected));
      button.classList.toggle("border-ink", selected);
      button.classList.toggle("text-ink", selected);
    });
}

const age = (date: string): string => {
  const minutes = Math.max(
    0,
    Math.round((Date.now() - new Date(date).getTime()) / 60_000),
  );
  if (minutes < 60)
    return `Submitted ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Submitted ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `Submitted ${days} day${days === 1 ? "" : "s"} ago`;
};

function positionTooltip(trigger: HTMLElement) {
  const bounds = trigger.getBoundingClientRect();
  tooltip.classList.remove("hidden");
  const tip = tooltip.getBoundingClientRect();
  const left = Math.min(
    innerWidth - tip.width - 8,
    Math.max(8, bounds.left + bounds.width / 2 - tip.width / 2),
  );
  const top =
    bounds.top > tip.height + 12
      ? bounds.top - tip.height - 8
      : bounds.bottom + 8;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function renderCountry(submission: ModerationSubmission) {
  const trigger = element<HTMLButtonElement>("#country-trigger");
  const name = countryName(submission.submission_country_code);
  const flag = countryFlag(submission.submission_country_code);
  trigger.textContent = flag ? `${flag}` : "◉ Unknown country";
  trigger.setAttribute("aria-label", `Submission country: ${name}`);
  tooltip.textContent = name;
}

function setLink(
  selector: string,
  urlValue: string | null,
  fallback = "Not provided",
) {
  const link = element<HTMLAnchorElement>(selector);
  if (!urlValue) {
    link.removeAttribute("href");
    link.textContent = fallback;
    return;
  }
  link.href = urlValue;
  try {
    link.textContent = `${new URL(urlValue).hostname} - ${urlValue}`;
  } catch {
    link.textContent = urlValue;
  }
}

function renderHistory(context: ModerationContext) {
  const list = element("#history-list");
  list.replaceChildren();
  const entries = [
    ...(context.flags ?? []).map((flag) => ({
      label: `Flag: ${flag.reason}${flag.resolved ? " (resolved)" : ""}`,
      detail: flag.notes ?? "",
    })),
    ...(context.actions ?? []).map((action) => ({
      label: `${titleCase(action.action)}${action.reason ? `: ${action.reason}` : ""}`,
      detail: action.notes ?? new Date(action.created_at).toLocaleString(),
    })),
  ];
  if (!entries.length) {
    list.textContent = "No previous moderation activity.";
    return;
  }
  entries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "rounded bg-soft p-3";
    const heading = document.createElement("p");
    heading.className = "font-medium text-ink";
    heading.textContent = entry.label;
    const detail = document.createElement("p");
    detail.className = "mt-1 whitespace-pre-wrap";
    detail.textContent = entry.detail;
    item.append(heading, detail);
    list.append(item);
  });
}

function renderSubmission() {
  const submission = current();
  if (!submission) {
    setQueueLabels(0);
    setLoading(`No ${activeQueue} submissions.`);
    show(queueState, true);
    return;
  }
  show(queueState, false);
  show(reportsView, false);
  show(archiveView, false);
  show(workspace, true);
  const reviewable = activeQueue === "pending" || activeQueue === "flagged";
  show(actionBar, reviewable);
  const flagButton = element<HTMLButtonElement>("#flag-button");
  const actionGrid = element("#review-action-grid");
  const canFlag = activeQueue === "pending";
  flagButton.classList.toggle("hidden", !canFlag);
  actionGrid.classList.toggle("grid-cols-3", canFlag);
  actionGrid.classList.toggle("grid-cols-2", !canFlag);
  setQueueLabels(submissions.length);
  text("#submission-organization", submission.organization);
  text("#submission-title", submission.name);
  text("#submission-status", titleCase(submission.status));
  text("#submission-age", age(submission.created_at));
  text(
    "#submission-location",
    submission.location
      ? `Location: ${submission.location}`
      : "Location not provided",
  );
  text(
    "#submission-deadline",
    submission.deadline
      ? `Deadline: ${submission.deadline}`
      : "No deadline supplied",
  );
  text("#submission-description", submission.description);
  text("#submission-eligibility", submission.eligibility);
  text("#submission-benefits", submission.benefits);
  text("#submitter-name", submission.submitter_name);
  text("#submitter-email", submission.submitter_email);
  text("#submitter-notes", submission.submitter_notes);
  text("#risk-score", submission.risk_score);
  text("#flag-count", submission.flag_count);
  renderCountry(submission);
  const primaryCategory = moderationCategory(submission);
  text(
    "#submission-primary-category",
    primaryCategory ? categories[primaryCategory] : "Unknown category",
  );
  renderPills(
    "#submission-subcategories",
    primaryCategory
      ? submission.subcategories.map((item) =>
          subcategoryLabel(primaryCategory, item),
        )
      : submission.subcategories,
  );
  renderPills("#submission-tags", submission.tags);
  setLink("#source-link", submission.source_url);
  setLink("#website-link", submission.organization_website_url);
  element<HTMLAnchorElement>("#open-source").href = submission.source_url;
  const sourceDomain = (() => {
    try {
      return new URL(submission.source_url).hostname;
    } catch {
      return "unknown domain";
    }
  })();
  element<HTMLAnchorElement>("#open-source").textContent =
    `Official source · ${sourceDomain}`;
  element<HTMLAnchorElement>("#search-title").href =
    `https://www.google.com/search?q=${encodeURIComponent(`"${submission.name}"`)}`;
  element<HTMLAnchorElement>("#search-organization").href =
    `https://www.google.com/search?q=${encodeURIComponent(submission.organization)}`;
  element<HTMLAnchorElement>("#search-domain").href =
    `https://www.google.com/search?q=${encodeURIComponent(`site:${sourceDomain}`)}`;
  element<HTMLAnchorElement>("#check-duplicates").href =
    `https://github.com/PerkCommons/data/search?q=${encodeURIComponent(submission.name)}&type=code`;
  element<HTMLAnchorElement>("#research-source").href = submission.source_url;
  element<HTMLAnchorElement>("#research-source").textContent =
    `Open official source · ${sourceDomain}`;
  const researchWebsite = element<HTMLAnchorElement>("#research-website");
  if (submission.organization_website_url) {
    researchWebsite.href = submission.organization_website_url;
    researchWebsite.removeAttribute("aria-disabled");
  } else {
    researchWebsite.removeAttribute("href");
    researchWebsite.setAttribute("aria-disabled", "true");
  }
  element<HTMLAnchorElement>("#research-title").href =
    element<HTMLAnchorElement>("#search-title").href;
  element<HTMLAnchorElement>("#research-provider").href =
    element<HTMLAnchorElement>("#search-organization").href;
  const warning = element("#submission-warning");
  if (submission.flag_count > 0 || submission.risk_score > 0) {
    warning.textContent = `${submission.flag_count} active flag${submission.flag_count === 1 ? "" : "s"}; automated risk score ${submission.risk_score}. Treat these as review prompts, not proof.`;
    warning.classList.remove("hidden");
  } else warning.classList.add("hidden");
  renderHistory({});
  const resolveFlags = element("#resolve-flags-button");
  resolveFlags.classList.toggle("hidden", activeQueue !== "flagged");
  resolveFlags.classList.toggle("flex", activeQueue === "flagged");
  void loadDetail(submission.id);
  card.style.transform = "";
  card.focus({ preventScroll: true });
}

async function loadDetail(id: string) {
  try {
    const data = await api<{
      flags: ModerationContext["flags"];
      actions: ModerationContext["actions"];
    }>(`/api/moderation/submissions/${id}`);
    if (current()?.id !== id) return;
    currentContext = { flags: data.flags ?? [], actions: data.actions ?? [] };
    renderHistory(currentContext);
  } catch (error) {
    announcer.textContent =
      error instanceof Error
        ? error.message
        : "Could not load moderation history.";
  }
}

function renderReports(reports: Array<Record<string, unknown>>) {
  show(queueState, false);
  show(workspace, false);
  show(actionBar, false);
  show(reportsView, true);
  show(archiveView, false);
  const list = element("#reports-list");
  list.replaceChildren();
  if (!reports.length) {
    queueState.textContent = "No open listing reports.";
    show(queueState, true);
    return;
  }
  reports.forEach((report) => {
    const article = document.createElement("article");
    article.className = "rounded-md border border-line bg-surface p-5";
    const heading = document.createElement("h3");
    heading.className = "font-semibold";
    heading.textContent = `${String(report.reason)} - ${String(report.listing_id)}`;
    const detail = document.createElement("p");
    detail.className = "mt-2 whitespace-pre-wrap text-sm leading-6 text-muted";
    detail.textContent = String(report.details || "No additional details.");
    const meta = document.createElement("p");
    meta.className = "mt-3 text-xs text-muted";
    meta.textContent = `Reported ${new Date(String(report.created_at)).toLocaleString()} · ${countryName(typeof report.reporter_country_code === "string" ? report.reporter_country_code : null)}`;
    const listingLink = document.createElement("a");
    listingLink.href = `/opportunities/${String(report.listing_id)}/`;
    listingLink.target = "_blank";
    listingLink.rel = "noopener noreferrer";
    listingLink.className = "mt-3 inline-flex min-h-11 items-center text-sm font-medium";
    listingLink.textContent = "Open reported listing";
    const actions = document.createElement("div");
    actions.className = "mt-4 grid gap-2 sm:grid-cols-2";
    const uphold = document.createElement("button");
    uphold.type = "button";
    uphold.className =
      "min-h-11 rounded-md bg-red-700 px-4 text-sm font-semibold text-white";
    uphold.textContent = "Approve report and remove listing";
    uphold.addEventListener("click", () =>
      openReportDecision(String(report.id), "upheld"),
    );
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className =
      "min-h-11 rounded-md border border-line px-4 text-sm font-semibold";
    dismiss.textContent = "Decline report and keep listing";
    dismiss.addEventListener("click", () =>
      openReportDecision(String(report.id), "dismissed"),
    );
    actions.append(uphold, dismiss);
    article.append(heading, detail, meta, listingLink, actions);
    list.append(article);
  });
}

function renderArchive() {
  show(queueState, false);
  show(workspace, false);
  show(reportsView, false);
  show(actionBar, false);
  show(archiveView, true);
  setQueueLabels(submissions.length);
  const list = element("#archive-list");
  const purgeAll = element("#purge-rejected-button");
  const publicationControls = element("#publication-controls");
  const rejected = activeQueue === "rejected";
  const approved = activeQueue === "approved";
  purgeAll.classList.toggle("hidden", !rejected || !submissions.length);
  purgeAll.classList.toggle("flex", rejected && Boolean(submissions.length));
  show(publicationControls, approved && moderatorRole === "admin");
  if (approved && moderatorRole === "admin") void loadPublicationState();
  else if (publicationTimer !== undefined) {
    window.clearTimeout(publicationTimer);
    publicationTimer = undefined;
  }
  list.replaceChildren();
  submissions.forEach((submission) => {
    const row = document.createElement("div");
    row.className = "flex min-h-14 items-center justify-between gap-4 py-3";
    const name = document.createElement("p");
    name.className = "min-w-0 truncate font-medium";
    name.textContent = submission.name;
    row.append(name);
    if (rejected) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className =
        "min-h-11 shrink-0 rounded-md px-3 text-sm font-semibold text-red-700";
      remove.textContent = "Delete";
      remove.addEventListener("click", () => void purgeRejected(submission.id));
      row.append(remove);
    }
    list.append(row);
  });
  if (!submissions.length) {
    queueState.textContent = `No ${activeQueue} submissions.`;
    show(queueState, true);
    show(archiveView, false);
  }
}

const publicationMessage = (batch: PublicationBatch | null): string => {
  if (!batch) return "Approved records will be validated in PerkCommons/data before deployment.";
  if (batch.status === "preparing") return "Preparing the publication pull request. Retry if this does not advance.";
  if (batch.status === "validating")
    return batch.last_error_code === "validation_failed"
      ? "Data validation failed. Open the pull request for details."
      : "The data pull request is waiting for validation.";
  if (batch.status === "merging") return "Validation passed. The data pull request is merging.";
  if (batch.status === "failed") return "This publication batch needs attention before it can be retried.";
  return batch.deployment_requested_at
    ? "Published and the site deployment was requested."
    : "Published. The site deployment will be requested shortly.";
};

async function loadPublicationState() {
  if (activeQueue !== "approved" || moderatorRole !== "admin") return;
  if (publicationTimer !== undefined) window.clearTimeout(publicationTimer);
  publicationTimer = undefined;
  const button = element<HTMLButtonElement>("#publish-approved-button");
  const status = element("#publication-status");
  const link = element<HTMLAnchorElement>("#publication-pr-link");
  try {
    const result = await api<{
      batch: PublicationBatch | null;
      approved_count: number;
    }>("/api/moderation/publications");
    const active =
      result.batch && ["preparing", "validating", "merging"].includes(result.batch.status);
    button.disabled = Boolean(active) || result.approved_count === 0;
    button.querySelector("span")!.textContent = active
      ? `Publishing ${result.batch!.item_count} approved`
      : result.approved_count
        ? `Publish all ${result.approved_count} approved`
        : "No approved submissions to publish";
    status.textContent = publicationMessage(result.batch);
    if (result.batch?.github_pr_url) {
      link.href = result.batch.github_pr_url;
      show(link, true);
    } else {
      link.removeAttribute("href");
      show(link, false);
    }
    if (active)
      publicationTimer = window.setTimeout(() => void loadPublicationState(), 8_000);
  } catch (error) {
    button.disabled = false;
    status.textContent =
      error instanceof Error ? error.message : "Publication status is unavailable.";
  }
}

async function publishApproved() {
  const button = element<HTMLButtonElement>("#publish-approved-button");
  if (!confirm("Publish every approved submission as one validated data batch?")) return;
  button.disabled = true;
  element("#publication-status").textContent = "Preparing publication batch...";
  try {
    const result = await api<{
      message: string;
      batch: PublicationBatch | null;
    }>("/api/moderation/publications", { method: "POST", body: "{}" });
    announcer.textContent = result.message;
    await loadPublicationState();
  } catch (error) {
    announcer.textContent =
      error instanceof Error ? error.message : "Publication could not be started.";
    await loadPublicationState();
  }
}

async function loadQueue(queueName: QueueName = activeQueue) {
  activeQueue = queueName;
  position = 0;
  currentContext = {};
  setLoading(
    queueName === "reports" ? "Loading reports..." : "Loading submissions...",
  );
  setQueueLabels(0);
  categoryFilter.disabled = queueName === "reports";
  try {
    if (queueName === "reports") {
      const result = await api<{
        count: number;
        reports: Array<Record<string, unknown>>;
      }>("/api/moderation/reports");
      setQueueLabels(result.count);
      renderReports(result.reports);
      return;
    }
    const result = await api<{
      count: number;
      submissions: ModerationSubmission[];
    }>(
      `/api/moderation/queue?status=${queueName}${categoryFilter.value ? `&category=${encodeURIComponent(categoryFilter.value)}` : ""}`,
    );
    submissions = result.submissions;
    if (["approved", "rejected", "published"].includes(queueName))
      renderArchive();
    else renderSubmission();
  } catch (error) {
    queueState.textContent = `${error instanceof Error ? error.message : "Could not load the queue."} Use refresh to try again.`;
    show(queueState, true);
  }
}

const dialog = (id: string) => element<DialogElement>(id);
const openDialog = (id: string) => dialog(id).showModal();
const closeDialogs = () =>
  document
    .querySelectorAll<DialogElement>("dialog[open]")
    .forEach((item) => item.close());

function openReportDecision(reportId: string, decision: "upheld" | "dismissed") {
  const form = element<HTMLFormElement>("#report-decision-form");
  (form.elements.namedItem("report_id") as HTMLInputElement).value = reportId;
  (form.elements.namedItem("decision") as HTMLInputElement).value = decision;
  (form.elements.namedItem("notes") as HTMLTextAreaElement).value = "";
  const upheld = decision === "upheld";
  text("#report-decision-heading", upheld ? "Approve report" : "Decline report");
  text(
    "#report-decision-description",
    upheld
      ? "This immediately suppresses the reported listing from the public index. Confirm only after checking the evidence."
      : "The report will be dismissed and the listing will remain public.",
  );
  const submit = element<HTMLButtonElement>("#report-decision-submit");
  submit.textContent = upheld ? "Approve and remove listing" : "Decline and keep listing";
  submit.className = `mt-5 min-h-11 w-full rounded-md px-4 font-semibold text-white ${upheld ? "bg-red-700" : "bg-action"}`;
  openDialog("#report-decision-dialog");
}

async function purgeRejected(id: string | null) {
  const label = id ? "this rejected submission" : "all rejected submissions";
  if (!confirm(`Permanently delete ${label}? This cannot be undone.`)) return;
  try {
    const result = await api<{ message: string; count: number }>(
      id ? `/api/moderation/submissions/${id}` : "/api/moderation/rejected",
      { method: "DELETE", body: "{}" },
    );
    announcer.textContent = result.message;
    await loadQueue("rejected");
  } catch (error) {
    announcer.textContent =
      error instanceof Error ? error.message : "Deletion failed.";
  }
}

function populateApproval() {
  const submission = current();
  if (!submission) return;
  const form = element<HTMLFormElement>("#approve-form");
  const assign = (name: string, value: string | null) => {
    const field = form.elements.namedItem(name) as
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    if (field) field.value = value ?? "";
  };
  assign("title", submission.name);
  assign("organization", submission.organization);
  const primaryCategory = moderationCategory(submission);
  assign("primary_category", primaryCategory);
  assign("tags", submission.tags.join(", "));
  updateApprovalSubcategories(primaryCategory, submission.subcategories);
  assign("description", submission.description);
  assign("eligibility", submission.eligibility);
  assign("benefits", submission.benefits);
  assign("location", submission.location);
  assign("deadline", submission.deadline);
  assign("source_url", submission.source_url);
  assign("organization_website_url", submission.organization_website_url);
  openDialog("#approve-dialog");
}

function updateApprovalSubcategories(
  category: string | null,
  selected: string[] = [],
) {
  document
    .querySelectorAll<HTMLElement>("[data-approval-subcategory-group]")
    .forEach((group) => {
      const active = group.dataset.approvalSubcategoryGroup === category;
      group.hidden = !active;
      group
        .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
        .forEach((input) => {
          input.disabled = !active;
          input.checked = active && selected.includes(input.value);
        });
    });
}

async function performAction(
  action: "approve" | "decline" | "flag" | "unflag",
  body: Record<string, unknown>,
) {
  const submission = current();
  if (!submission) return;
  const id = submission.id;
  try {
    await api(`/api/moderation/submissions/${id}/${action}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    closeDialogs();
    submissions.splice(position, 1);
    if (position >= submissions.length)
      position = Math.max(0, submissions.length - 1);
    showUndo(id, `${titleCase(action)} recorded.`);
    announcer.textContent = `${submission.name}: ${action} recorded.`;
    renderSubmission();
  } catch (error) {
    announcer.textContent =
      error instanceof Error ? error.message : "Action failed.";
  }
}

function showUndo(id: string, message: string) {
  undoTarget = id;
  text("#undo-message", message);
  const snackbar = element("#undo-snackbar");
  snackbar.classList.remove("hidden");
  snackbar.classList.add("flex");
  if (undoTimer) clearTimeout(undoTimer);
  undoTimer = window.setTimeout(() => {
    snackbar.classList.add("hidden");
    snackbar.classList.remove("flex");
    undoTarget = null;
  }, 10_000);
}

async function undo() {
  if (!undoTarget) return;
  try {
    await api(`/api/moderation/submissions/${undoTarget}/undo`, {
      method: "POST",
      body: "{}",
    });
    element("#undo-snackbar").classList.add("hidden");
    announcer.textContent = "Previous action undone.";
    undoTarget = null;
    await loadQueue();
  } catch (error) {
    announcer.textContent =
      error instanceof Error ? error.message : "Undo failed.";
  }
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText)
    await navigator.clipboard.writeText(value);
  else {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    (
      document as unknown as { execCommand(command: string): boolean }
    ).execCommand("copy");
    area.remove();
  }
  announcer.textContent = "Copied to clipboard.";
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("input, textarea, select, [contenteditable=true]"))
  );
}

async function loadBans() {
  const list = element("#ban-list");
  list.textContent = "Loading active controls...";
  try {
    const result = await api<{
      bans: Array<{
        id: string;
        identifier_type: string;
        display_hint: string;
        reason: string;
        mode: string;
        expires_at: string | null;
      }>;
    }>("/api/moderation/bans");
    list.replaceChildren();
    if (!result.bans.length) {
      list.textContent = "No active abuse controls.";
      return;
    }
    result.bans.forEach((ban) => {
      const row = document.createElement("div");
      row.className =
        "flex items-center justify-between gap-3 rounded bg-soft p-3";
      const label = document.createElement("span");
      label.textContent = `${ban.display_hint} · ${ban.mode} · ${ban.reason}${ban.expires_at ? ` · expires ${new Date(ban.expires_at).toLocaleDateString()}` : " · permanent"}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "min-h-11 shrink-0 px-2 font-medium text-red-700";
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        if (!confirm("Remove this abuse control? The removal will be audited."))
          return;
        try {
          await api(`/api/moderation/bans/${ban.id}`, { method: "DELETE" });
          row.remove();
          announcer.textContent = "Abuse control removed.";
        } catch (error) {
          announcer.textContent =
            error instanceof Error ? error.message : "Removal failed.";
        }
      });
      row.append(label, remove);
      list.append(row);
    });
  } catch (error) {
    list.textContent =
      error instanceof Error ? error.message : "Could not load abuse controls.";
  }
}

async function loadModerators() {
  const list = element("#moderator-list");
  list.textContent = "Loading moderator profiles...";
  try {
    const result = await api<{
      moderators: Array<{
        user_id: string;
        role: string;
        active: boolean;
      }>;
    }>("/api/moderation/moderators");
    list.replaceChildren();
    result.moderators.forEach((profile) => {
      const row = document.createElement("p");
      row.className = "rounded bg-soft p-3 break-all";
      row.textContent = `${profile.user_id} · ${profile.role} · ${profile.active ? "active" : "inactive"}`;
      list.append(row);
    });
    if (!result.moderators.length) list.textContent = "No moderator profiles.";
  } catch (error) {
    list.textContent =
      error instanceof Error
        ? error.message
        : "Could not load moderator profiles.";
  }
}

element("#queue-tabs").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-queue]",
  );
  if (button?.dataset.queue) void loadQueue(button.dataset.queue as QueueName);
});
element("#refresh-queue").addEventListener("click", () => void loadQueue());
categoryFilter.addEventListener("change", () => void loadQueue());
element("#logout-button").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  location.assign("/moderator-login/");
});
element("#approve-button").addEventListener("click", populateApproval);
element("#decline-button").addEventListener("click", () =>
  openDialog("#decline-dialog"),
);
element("#flag-button").addEventListener("click", () =>
  openDialog("#flag-dialog"),
);
element("#resolve-flags-button").addEventListener(
  "click",
  () => void performAction("unflag", { reason: "Flags resolved" }),
);
element("#copy-menu-button").addEventListener("click", () =>
  openDialog("#copy-dialog"),
);
element("#research-menu-button").addEventListener("click", () =>
  openDialog("#research-dialog"),
);
element("#ban-button").addEventListener("click", () => {
  openDialog("#ban-dialog");
  void loadBans();
});
element("#moderators-button").addEventListener("click", () => {
  openDialog("#moderators-dialog");
  void loadModerators();
});
element("#undo-button").addEventListener("click", () => void undo());
element("#purge-rejected-button").addEventListener("click", () =>
  void purgeRejected(null),
);
element("#publish-approved-button").addEventListener("click", () =>
  void publishApproved(),
);
document
  .querySelectorAll<HTMLElement>("[data-close-dialog]")
  .forEach((button) => button.addEventListener("click", closeDialogs));
document.querySelectorAll<DialogElement>("dialog").forEach((item) =>
  item.addEventListener("click", (event) => {
    if (event.target === item) item.close();
  }),
);

element<HTMLFormElement>("#approve-form").addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const tags = String(data.get("tags") ?? "")
      .split(",")
      .map((tag) =>
        tag
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      )
      .filter((tag, index, values) => tag && values.indexOf(tag) === index);
    void performAction("approve", {
      normalized: {
        title: data.get("title"),
        organization: data.get("organization"),
        primary_category: data.get("primary_category"),
        subcategories: data.getAll("subcategories").map(String),
        tags,
        categories: [data.get("primary_category")],
        description: data.get("description"),
        eligibility: data.get("eligibility"),
        benefits: data.get("benefits"),
        location: data.get("location"),
        deadline: data.get("deadline"),
        source_url: data.get("source_url"),
        organization_website_url: data.get("organization_website_url"),
      },
    });
  },
);
element<HTMLSelectElement>("#approval-category").addEventListener(
  "change",
  (event) =>
    updateApprovalSubcategories(
      (event.currentTarget as HTMLSelectElement).value,
    ),
);
element<HTMLFormElement>("#decline-form").addEventListener(
  "submit",
  (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget as HTMLFormElement);
    void performAction("decline", {
      reason: data.get("reason"),
      notes: data.get("notes"),
    });
  },
);
element<HTMLFormElement>("#flag-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(event.currentTarget as HTMLFormElement);
  void performAction("flag", {
    reason: data.get("reason"),
    notes: data.get("notes"),
  });
});
element<HTMLFormElement>("#report-decision-form").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const reportId = String(data.get("report_id") ?? "");
    const decision = String(data.get("decision") ?? "");
    if (!reportId || !["upheld", "dismissed"].includes(decision)) return;
    if (
      decision === "upheld" &&
      !confirm("Remove the reported listing from the public index?")
    )
      return;
    try {
      const result = await api<{ message: string }>(
        `/api/moderation/reports/${reportId}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({
            decision,
            notes: data.get("notes"),
          }),
        },
      );
      closeDialogs();
      announcer.textContent = result.message;
      await loadQueue("reports");
    } catch (error) {
      announcer.textContent =
        error instanceof Error ? error.message : "Could not resolve report.";
    }
  },
);
const banForm = element<HTMLFormElement>("#ban-form");
const durationField = banForm.elements.namedItem(
  "duration_hours",
) as HTMLSelectElement;
durationField.addEventListener("change", () => {
  const label = element("#custom-expiry-label");
  label.classList.toggle("hidden", durationField.value !== "custom");
  label.classList.toggle("block", durationField.value === "custom");
});
banForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submission = current();
  if (!submission) return;
  const data = new FormData(banForm);
  const action = String(data.get("action"));
  if (action === "reject") {
    closeDialogs();
    openDialog("#decline-dialog");
    return;
  }
  const identifier_type =
    action === "flag" || action === "warn" ? "email" : action;
  const mode =
    action === "flag" ? "flag" : action === "warn" ? "warn" : "block";
  try {
    await api("/api/moderation/bans", {
      method: "POST",
      body: JSON.stringify({
        submission_id: submission.id,
        identifier_type,
        mode,
        duration_hours: Number(data.get("duration_hours")) || null,
        expires_at:
          durationField.value === "custom" ? data.get("custom_expiry") : null,
        reason: data.get("reason"),
        notes: data.get("notes"),
      }),
    });
    closeDialogs();
    announcer.textContent = "Abuse control created.";
  } catch (error) {
    announcer.textContent =
      error instanceof Error ? error.message : "Abuse control failed.";
  }
});

element<HTMLFormElement>("#moderators-form").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    try {
      await api("/api/moderation/moderators", {
        method: "POST",
        body: JSON.stringify({
          user_id: data.get("user_id"),
          role: data.get("role"),
          active: data.get("active") === "on",
        }),
      });
      announcer.textContent = "Moderator profile updated.";
      form.reset();
      void loadModerators();
    } catch (error) {
      announcer.textContent =
        error instanceof Error ? error.message : "Profile update failed.";
    }
  },
);

document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((button) =>
  button.addEventListener("click", async () => {
    const submission = current();
    if (!submission) return;
    const mode = button.dataset.copy;
    const output =
      mode === "publication"
        ? buildPublicationData(submission)
        : buildReviewBrief(submission, currentContext, mode === "redacted");
    await copyText(output);
    closeDialogs();
  }),
);
element("#copy-domain").addEventListener("click", () => {
  const submission = current();
  if (!submission) return;
  try {
    void copyText(new URL(submission.source_url).hostname);
  } catch {
    announcer.textContent = "Source domain is invalid.";
  }
});
element("#copy-source").addEventListener("click", () => {
  const submission = current();
  if (submission) void copyText(submission.source_url);
});

const countryTrigger = element<HTMLElement>("#country-trigger");
const showCountry = () => positionTooltip(countryTrigger);
const hideCountry = () => tooltip.classList.add("hidden");
countryTrigger.addEventListener("mouseenter", showCountry);
countryTrigger.addEventListener("focus", showCountry);
countryTrigger.addEventListener("mouseleave", hideCountry);
countryTrigger.addEventListener("blur", hideCountry);
countryTrigger.addEventListener("click", () =>
  tooltip.classList.contains("hidden") ? showCountry() : hideCountry(),
);

let gesture: {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
} | null = null;
card.addEventListener("pointerdown", (event) => {
  if (activeQueue !== "pending" && activeQueue !== "flagged") return;
  if (
    (event.target as HTMLElement).closest(
      "button, a, input, textarea, select, details, summary, [data-swipe-ignore]",
    ) ||
    getSelection()?.toString()
  )
    return;
  gesture = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    dx: 0,
    dy: 0,
  };
  card.setPointerCapture(event.pointerId);
});
card.addEventListener("pointermove", (event) => {
  if (!gesture || gesture.id !== event.pointerId) return;
  gesture.dx = event.clientX - gesture.x;
  gesture.dy = event.clientY - gesture.y;
  const horizontal = Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.25;
  const upward =
    activeQueue === "pending" &&
    gesture.dy < -35 && Math.abs(gesture.dy) > Math.abs(gesture.dx) * 1.25;
  if (!horizontal && !upward) return;
  card.style.transform = `translate3d(${horizontal ? gesture.dx : 0}px, ${upward ? gesture.dy * 0.35 : 0}px, 0) rotate(${horizontal ? gesture.dx / 35 : 0}deg)`;
  overlay.textContent = upward
    ? "FLAG"
    : gesture.dx > 0
      ? "APPROVE"
      : "DECLINE";
  overlay.dataset.action = upward
    ? "flag"
    : gesture.dx > 0
      ? "approve"
      : "decline";
  overlay.classList.remove("hidden");
  overlay.classList.add("grid");
});
const finishGesture = () => {
  if (!gesture) return;
  const { dx, dy } = gesture;
  gesture = null;
  overlay.classList.add("hidden");
  overlay.classList.remove("grid");
  card.style.transform = "";
  if (Math.abs(dx) >= 120 && Math.abs(dx) > Math.abs(dy) * 1.25)
    dx > 0 ? populateApproval() : openDialog("#decline-dialog");
  else if (
    activeQueue === "pending" &&
    dy <= -110 &&
    Math.abs(dy) > Math.abs(dx) * 1.25
  )
    openDialog("#flag-dialog");
};
card.addEventListener("pointerup", finishGesture);
card.addEventListener("pointercancel", finishGesture);

document.addEventListener("keydown", (event) => {
  if (isTyping(event.target) || document.querySelector("dialog[open]")) return;
  const key = event.key.toLowerCase();
  const reviewable = activeQueue === "pending" || activeQueue === "flagged";
  if (reviewable && (key === "arrowleft" || key === "d")) {
    event.preventDefault();
    openDialog("#decline-dialog");
  }
  if (reviewable && (key === "arrowright" || key === "a")) {
    event.preventDefault();
    populateApproval();
  }
  if (activeQueue === "pending" && key === "f") {
    event.preventDefault();
    openDialog("#flag-dialog");
  }
  if (key === "z") {
    event.preventDefault();
    void undo();
  }
  if (key === "c") {
    event.preventDefault();
    openDialog("#copy-dialog");
  }
});

async function initialize() {
  try {
    const result = await api<{ moderator: { role: "reviewer" | "admin" } }>(
      "/api/auth/me",
    );
    moderatorRole = result.moderator.role;
    if (moderatorRole === "admin")
      document.querySelectorAll<HTMLElement>(".admin-only").forEach((item) => {
        item.classList.remove("hidden");
        item.classList.add("flex");
      });
    await loadQueue();
  } catch (error) {
    if (location.pathname.startsWith("/moderate"))
      announcer.textContent =
        error instanceof Error ? error.message : "Authentication failed.";
  }
}

void initialize();
