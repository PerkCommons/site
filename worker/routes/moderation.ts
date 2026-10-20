import { isCountryCode, parseCountryCodes } from "../../src/lib/geography.js";
import {
  clearSessionCookie,
  requireModerator,
  sessionCookie,
  authenticateToken,
} from "../lib/auth.js";
import { maskEmail } from "../lib/fingerprints.js";
import { actionAllowedForStatus } from "../lib/moderation-policy.js";
import {
  publicationBatchStatus,
  startPublicationBatch,
} from "../lib/publication.js";
import { prepareListingRemovalForReport } from "../lib/removal.js";
import {
  apiError,
  assertSameOrigin,
  json,
  readJson,
  RequestError,
} from "../lib/http.js";
import {
  callRpc,
  insertRows,
  SupabaseError,
  supabaseRequest,
} from "../lib/supabase.js";
import type { Env, Moderator, SubmissionStatus } from "../lib/types.js";
import {
  optionalNote,
  requiredChoice,
  safeHttpsUrl,
} from "../lib/validation.js";
import {
  isSubcategoryFor,
  normalizeCategoryId,
} from "../../src/lib/taxonomy.js";

const DECLINE_REASONS = new Set([
  "Duplicate",
  "Not a real opportunity",
  "Insufficient evidence",
  "Expired",
  "Misleading information",
  "Promotional spam",
  "Ineligible content",
  "Unsafe or suspicious",
  "Other",
]);
const FLAG_REASONS = new Set([
  "Needs deeper verification",
  "Possible scam",
  "Broken source",
  "Duplicate",
  "Incorrect details",
  "Privacy concern",
  "Conflict of interest",
  "Suspicious submitter",
  "Requires second reviewer",
  "Other",
]);
const QUEUES = new Set([
  "pending",
  "flagged",
  "approved",
  "rejected",
  "published",
]);
const RESOURCE_TYPES = new Set([
  "opportunity", "resource", "benefit", "program", "event", "funding",
  "fellowship", "competition", "community", "learning-resource",
  "public-dataset", "general-free-product",
]);
const AVAILABILITY_STATUSES = new Set([
  "open", "rolling", "upcoming", "limited", "waitlist",
  "temporarily-unavailable", "closed", "expired", "unconfirmed",
  "disputed", "archived",
]);
const DEADLINE_TYPES = new Set(["fixed", "rolling", "periodic", "unknown", "none"]);
const REVIEW_CLAIMS = new Set([
  "program-exists", "eligibility", "benefit", "application-url", "deadline", "geography",
]);

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RequestError("Invalid request body.", 400, "invalid_payload");
  return value as Record<string, unknown>;
};

const submissionSelect =
  "id,name,organization,categories,primary_category,subcategories,tags,description,eligibility,benefits,location,deadline,source_url,organization_website_url,submitter_name,submitter_email,submitter_notes,status,risk_score,flag_count,submission_country_code,created_at,updated_at,reviewed_at,published_at,last_action_at,decision_reason,submission_kind,target_listing_id,proposed_by_moderator,original_created_at";
const submissionSummarySelect =
  "id,name,organization,primary_category,status,risk_score,flag_count,submission_country_code,created_at,updated_at,submission_kind,target_listing_id";

export async function createSession(
  request: Request,
  env: Env,
): Promise<Response> {
  assertSameOrigin(request);
  const body = asRecord(await readJson(request, 8_000));
  if (typeof body.access_token !== "string" || body.access_token.length > 8_000)
    throw new RequestError("Invalid session.", 400, "invalid_session");
  const moderator = await authenticateToken(env, body.access_token);
  if (!moderator)
    return apiError(
      "This account does not have active moderator access.",
      403,
      "not_moderator",
    );
  return json(
    { moderator: { email: moderator.email, role: moderator.role } },
    200,
    { "set-cookie": sessionCookie(body.access_token) },
  );
}

export async function destroySession(request: Request): Promise<Response> {
  assertSameOrigin(request);
  return json({ message: "Signed out." }, 200, {
    "set-cookie": clearSessionCookie(),
  });
}

export async function currentModerator(
  request: Request,
  env: Env,
): Promise<Response> {
  const moderator = await requireModerator(request, env);
  return json({ moderator: { email: moderator.email, role: moderator.role } });
}

export async function queue(request: Request, env: Env): Promise<Response> {
  await requireModerator(request, env);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  const categoryParameter = url.searchParams.get("category");
  const category = categoryParameter
    ? normalizeCategoryId(categoryParameter)
    : null;
  if (!QUEUES.has(status))
    throw new RequestError("Unknown moderation queue.", 400, "invalid_queue");
  if (categoryParameter && !category)
    throw new RequestError("Unknown opportunity category.", 400, "invalid_category");
  const categoryFilter = category ? `&primary_category=eq.${category}` : "";
  const statusFilter = status === "pending" ? "in.(pending,reviewing)" : `eq.${status}`;
  const query = `/rest/v1/opportunity_submissions?status=${statusFilter}${categoryFilter}&select=${submissionSelect}&order=created_at.asc&limit=50`;
  const { data } = await supabaseRequest<unknown[]>(env, query);
  return json({ queue: status, count: data.length, submissions: data });
}

export async function queueSummary(request: Request, env: Env): Promise<Response> {
  await requireModerator(request, env);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  const categoryParameter = url.searchParams.get("category");
  const category = categoryParameter ? normalizeCategoryId(categoryParameter) : null;
  if (!QUEUES.has(status)) throw new RequestError("Unknown moderation queue.", 400, "invalid_queue");
  if (categoryParameter && !category) throw new RequestError("Unknown opportunity category.", 400, "invalid_category");
  const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "25", 10) || 25));
  const after = url.searchParams.get("after");
  if (after && Number.isNaN(Date.parse(after))) throw new RequestError("Queue cursor is invalid.", 400, "invalid_cursor");
  const categoryFilter = category ? `&primary_category=eq.${category}` : "";
  const cursorFilter = after ? `&created_at=gt.${encodeURIComponent(after)}` : "";
  const statusFilter = status === "pending" ? "in.(pending,reviewing)" : `eq.${status}`;
  const query = `/rest/v1/opportunity_submissions?status=${statusFilter}${categoryFilter}${cursorFilter}&select=${submissionSummarySelect}&order=created_at.asc,id.asc&limit=${limit}`;
  const result = await supabaseRequest<Array<{ id: string; created_at: string }>>(env, query, { headers: { prefer: "count=exact" } });
  const total = Number(result.response.headers.get("content-range")?.split("/")[1] ?? result.data.length);
  return json({
    queue: status,
    total: Number.isFinite(total) ? total : result.data.length,
    count: result.data.length,
    nextCursor: result.data.length === limit ? result.data[result.data.length - 1]?.created_at ?? null : null,
    submissions: result.data,
  });
}

export async function submissionDetail(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  await requireModerator(request, env);
  const [submission, normalized, flags, actions] = await Promise.all([
    supabaseRequest<unknown[]>(
      env,
      `/rest/v1/opportunity_submissions?id=eq.${encodeURIComponent(id)}&select=${submissionSelect}&limit=1`,
    ),
    supabaseRequest<unknown[]>(
      env,
      `/rest/v1/normalized_opportunities?submission_id=eq.${encodeURIComponent(id)}&select=*&limit=1`,
    ),
    supabaseRequest<unknown[]>(
      env,
      `/rest/v1/submission_flags?submission_id=eq.${encodeURIComponent(id)}&select=id,reason,notes,resolved,created_at&order=created_at.desc`,
    ),
    supabaseRequest<unknown[]>(
      env,
      `/rest/v1/moderation_actions?submission_id=eq.${encodeURIComponent(id)}&select=id,action,reason,notes,previous_status,new_status,created_at&order=created_at.desc&limit=30`,
    ),
  ]);
  if (!submission.data[0])
    return apiError("Submission was not found.", 404, "not_found");
  return json({
    submission: submission.data[0],
    normalized: normalized.data[0] ?? null,
    flags: flags.data,
    actions: actions.data,
  });
}

const moderate = async (
  env: Env,
  moderator: Moderator,
  id: string,
  action: string,
  reason: string | null,
  notes: string | null,
  normalized: unknown = null,
): Promise<Response> => {
  const actionId = await callRpc<string>(env, "perform_moderation_action", {
    p_submission_id: id,
    p_moderator_id: moderator.userId,
    p_action: action,
    p_reason: reason,
    p_notes: notes,
    p_normalized: normalized,
  });
  return json({ message: "Moderation action recorded.", action_id: actionId });
};

const normalizedData = (value: unknown): Record<string, unknown> => {
  const body = asRecord(value);
  const normalized = asRecord(body.normalized);
  const text = (key: string, max: number, required = true) => {
    const value = normalized[key];
    if (!required && (value === null || value === undefined || value === ""))
      return null;
    if (typeof value !== "string" || !value.trim() || value.trim().length > max)
      throw new RequestError(`${key} is invalid.`, 400, "validation_failed");
    return value.trim();
  };
  const legacyCategories = Array.isArray(normalized.categories)
    ? normalized.categories
    : [];
  const primaryCategory = normalizeCategoryId(
    normalized.primary_category ?? legacyCategories[0],
  );
  const subcategories = normalized.subcategories ?? [];
  const tags = normalized.tags ?? [];
  const countries = normalized.countries ?? [];
  const claimsChecked = normalized.claims_checked ?? [];
  if (
    !primaryCategory ||
    !Array.isArray(subcategories) ||
    subcategories.length > 8 ||
    subcategories.some(
      (subcategory) => !isSubcategoryFor(primaryCategory, subcategory),
    ) ||
    new Set(subcategories).size !== subcategories.length
  )
    throw new RequestError("Category selection is invalid.", 400, "validation_failed");
  if (
    !Array.isArray(tags) ||
    tags.length > 12 ||
    tags.some(
      (tag) =>
        typeof tag !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag),
    ) ||
    new Set(tags).size !== tags.length
  )
    throw new RequestError("Tags are invalid.", 400, "validation_failed");
  if (
    !Array.isArray(countries) || countries.length > 30 ||
    countries.some((country) => !isCountryCode(country)) ||
    new Set(countries).size !== countries.length
  )
    throw new RequestError("Countries are invalid.", 400, "validation_failed");
  if (
    !Array.isArray(claimsChecked) || claimsChecked.length === 0 ||
    claimsChecked.some((claim) => typeof claim !== "string" || !REVIEW_CLAIMS.has(claim)) ||
    new Set(claimsChecked).size !== claimsChecked.length
  )
    throw new RequestError("Select the claims checked during review.", 400, "validation_failed");
  const triState = (key: string): boolean | null => {
    const value = normalized[key];
    if (value === "unknown" || value === null || value === undefined) return null;
    if (value === "true" || value === true) return true;
    if (value === "false" || value === false) return false;
    throw new RequestError(`${key} is invalid.`, 400, "validation_failed");
  };
  const resourceType = requiredChoice(normalized.resource_type, RESOURCE_TYPES, "Resource type");
  const defaultSearchEligible = triState("default_search_eligible");
  if (defaultSearchEligible === null)
    throw new RequestError("Default search eligibility requires an explicit decision.", 400, "validation_failed");
  const availabilityStatus = requiredChoice(normalized.availability_status, AVAILABILITY_STATUSES, "Availability status");
  const deadlineType = requiredChoice(normalized.deadline_type, DEADLINE_TYPES, "Deadline type");
  const validDate = (date: string): boolean => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date;
  };
  const deadline = text("deadline", 10, false);
  const applicationCycle = text("application_cycle", 500, false);
  if (deadline && !validDate(deadline))
    throw new RequestError("Deadline is invalid.", 400, "validation_failed");
  if (deadlineType === "fixed" && !deadline)
    throw new RequestError("A fixed deadline requires a date.", 400, "validation_failed");
  const sponsored = triState("sponsored");
  const sponsorshipType = text("sponsorship_type", 100, false);
  const sponsorshipDisclosure = text("sponsorship_disclosure", 1_000, false);
  if (sponsored === true && (!sponsorshipType || !sponsorshipDisclosure))
    throw new RequestError("Sponsored records require a type and public disclosure.", 400, "validation_failed");
  const providerUrl = safeHttpsUrl(normalized.provider_url, "Provider URL", false);
  const programUrl = safeHttpsUrl(normalized.program_url, "Program URL") as string;
  const applicationUrl = safeHttpsUrl(normalized.application_url, "Application URL", false);
  const nextReviewAt = text("next_review_at", 10, false);
  if (nextReviewAt && !validDate(nextReviewAt))
    throw new RequestError("Next review date is invalid.", 400, "validation_failed");
  const location = text("location", 120, false);
  const physicalLocationInput = normalized.physical_locations;
  if (
    physicalLocationInput !== undefined &&
    (
      !Array.isArray(physicalLocationInput) ||
      physicalLocationInput.length > 20 ||
      physicalLocationInput.some(
        (item) =>
          typeof item !== "string" ||
          item.trim().length < 2 ||
          item.trim().length > 200,
      ) ||
      new Set(physicalLocationInput).size !== physicalLocationInput.length
    )
  )
    throw new RequestError("Physical locations are invalid.", 400, "validation_failed");
  const inferredCountries = countries.length ? countries : parseCountryCodes(location);
  const resolvedGlobal = triState("global") ??
    (inferredCountries.length === 0 && (!location || ["global", "remote", "online"].includes(location.toLowerCase())));
  if ((resolvedGlobal && inferredCountries.length > 0) || (!resolvedGlobal && inferredCountries.length === 0))
    throw new RequestError("Choose Global or specify eligible countries.", 400, "validation_failed");
  const physicalLocations = Array.isArray(physicalLocationInput)
    ? physicalLocationInput.map((item) => String(item).trim())
    : location && !["global", "remote", "online"].includes(location.toLowerCase()) && inferredCountries.length === 0
      ? [location]
      : [];
  return {
    title: text("title", 140),
    organization: text("organization", 100),
    categories: [primaryCategory],
    primary_category: primaryCategory,
    subcategories,
    tags,
    description: text("description", 2_000),
    eligibility: text("eligibility", 2_000),
    benefits: text("benefits", 2_000, false),
    location,
    deadline,
    source_url: programUrl,
    organization_website_url: providerUrl,
    resource_type: resourceType,
    default_search_eligible: defaultSearchEligible,
    availability_status: availabilityStatus,
    status_reason: text("status_reason", 1_000, false),
    deadline_type: deadlineType,
    application_cycle: applicationCycle,
    global: resolvedGlobal,
    remote: triState("remote"),
    countries: inferredCountries,
    physical_locations: physicalLocations,
    provider_url: providerUrl,
    program_url: programUrl,
    application_url: applicationUrl,
    sponsored,
    sponsorship_type: sponsorshipType,
    sponsorship_disclosure: sponsorshipDisclosure,
    claims_checked: claimsChecked,
    next_review_at: nextReviewAt,
  };
};

interface CatalogSummary {
  id: string;
  provider: string;
  title: string;
  description: string;
  benefit: string;
  category: string;
  categoryLabel: string;
  status: string;
  reviewDate: string;
  resourceType: string;
  defaultSearchEligible: boolean | null;
  canonicalUrl: string;
  destinationUrl: string;
}

interface ExportedListing {
  schemaVersion?: "1" | "2.0";
  id: string;
  provider: string;
  title: string;
  category: string;
  subcategories: string[];
  tags: string[];
  description: string;
  eligibility: string;
  value: string;
  sourceUrl: string;
  officialUrl: string;
  status: string;
  reviewDate: string;
  resourceType?: string;
  defaultSearchEligible?: boolean | null;
  providerUrl?: string | null;
  programUrl?: string | null;
  applicationUrl?: string | null;
  deadline?: string | null;
  deadlineType?: string | null;
  applicationCycle?: string | null;
  global?: boolean | null;
  remote?: boolean | null;
  countries?: string[];
  physicalLocations?: string[];
  regions?: string[];
  statusReason?: string | null;
  reviewedAt?: string | null;
  nextReviewAt?: string | null;
  claimsChecked?: string[];
  sponsor?: boolean;
  sponsorshipType?: string | null;
  sponsorshipDisclosure?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  editorialReviewState?: string;
  verified?: boolean;
}

const staticRecords = async <T>(
  request: Request,
  env: Env,
  assetPath: string,
): Promise<T[]> => {
  const assetRequest = new Request(new URL(assetPath, request.url), {
    method: "GET",
  });
  const asset = env.ASSETS
    ? await env.ASSETS.fetch(assetRequest)
    : await fetch(assetRequest);
  if (!asset.ok)
    throw new RequestError(
      "The catalogue asset is unavailable.",
      503,
      "catalogue_unavailable",
    );
  // These are bounded, build-generated assets owned by this Worker deployment.
  const payload = (await asset.json()) as { records?: unknown };
  if (!Array.isArray(payload.records))
    throw new RequestError(
      "The catalogue asset is invalid.",
      503,
      "catalogue_unavailable",
    );
  return payload.records as T[];
};

const queueCursor = (value: string | null): number => {
  if (!value) return 0;
  try {
    const offset = Number.parseInt(atob(value), 10);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error();
    return offset;
  } catch {
    throw new RequestError(
      "Queue cursor is invalid.",
      400,
      "invalid_cursor",
    );
  }
};

export async function unconfirmedListings(
  request: Request,
  env: Env,
): Promise<Response> {
  await requireModerator(request, env);
  const url = new URL(request.url);
  const categoryParameter = url.searchParams.get("category");
  const category = categoryParameter
    ? normalizeCategoryId(categoryParameter)
    : null;
  if (categoryParameter && !category)
    throw new RequestError(
      "Unknown opportunity category.",
      400,
      "invalid_category",
    );
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  if (search.length > 120)
    throw new RequestError("Search is too long.", 400, "validation_failed");
  const limit = Math.min(
    50,
    Math.max(
      1,
      Number.parseInt(url.searchParams.get("limit") ?? "25", 10) || 25,
    ),
  );
  const offset = queueCursor(url.searchParams.get("cursor"));
  const records = (await staticRecords<CatalogSummary>(
    request,
    env,
    "/catalog-index.json",
  ))
    .filter((record) => record.status === "unconfirmed")
    .filter((record) => !category || record.category === category)
    .filter(
      (record) =>
        !search ||
        [
          record.id,
          record.provider,
          record.title,
          record.description,
          record.benefit,
        ].some((field) => field.toLowerCase().includes(search)),
    )
    .sort(
      (left, right) =>
        left.reviewDate.localeCompare(right.reviewDate) ||
        left.provider.localeCompare(right.provider) ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id),
    );
  const listings = records.slice(offset, offset + limit);
  const nextOffset = offset + listings.length;
  return json({
    queue: "unconfirmed",
    total: records.length,
    count: listings.length,
    nextCursor: nextOffset < records.length ? btoa(String(nextOffset)) : null,
    listings,
  });
}

export async function publishedReviewListings(
  request: Request,
  env: Env,
): Promise<Response> {
  await requireModerator(request, env);
  const url = new URL(request.url);
  const categoryParameter = url.searchParams.get("category");
  const category = categoryParameter
    ? normalizeCategoryId(categoryParameter)
    : null;
  if (categoryParameter && !category)
    throw new RequestError(
      "Unknown opportunity category.",
      400,
      "invalid_category",
    );
  const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
  if (search.length > 120)
    throw new RequestError("Search is too long.", 400, "validation_failed");
  const limit = Math.min(
    50,
    Math.max(
      1,
      Number.parseInt(url.searchParams.get("limit") ?? "25", 10) || 25,
    ),
  );
  const offset = queueCursor(url.searchParams.get("cursor"));
  const [records, removedRows] = await Promise.all([
    staticRecords<ExportedListing>(request, env, "/data/opportunities.json"),
    supabaseRequest<Array<{ listing_id: string }>>(
      env,
      "/rest/v1/listing_moderation_state?removed=eq.true&select=listing_id&limit=5000",
    ).then((result) => result.data),
  ]);
  const removed = new Set(removedRows.map((row) => row.listing_id));
  const filtered = records
    .filter((record) => !removed.has(record.id))
    .filter((record) => !category || record.category === category)
    .filter(
      (record) =>
        !search ||
        [record.id, record.provider, record.title, record.description, record.value]
          .filter((field): field is string => typeof field === "string")
          .some((field) => field.toLowerCase().includes(search)),
    )
    .sort((left, right) => {
      const leftReviewed = left.reviewedAt?.slice(0, 10) ?? "";
      const rightReviewed = right.reviewedAt?.slice(0, 10) ?? "";
      if (!leftReviewed && rightReviewed) return -1;
      if (leftReviewed && !rightReviewed) return 1;
      const dateOrder = leftReviewed.localeCompare(rightReviewed);
      if (dateOrder) return dateOrder;
      return (
        left.title.localeCompare(right.title) ||
        left.provider.localeCompare(right.provider) ||
        left.id.localeCompare(right.id)
      );
    });
  const page = filtered.slice(offset, offset + limit).map((listing) => ({
    id: listing.id,
    provider: listing.provider,
    title: listing.title,
    category: listing.category,
    status: listing.status,
    reviewDate: listing.reviewDate,
    reviewedAt: listing.reviewedAt ?? null,
    nextReviewAt: listing.nextReviewAt ?? null,
    editorialReviewState: listing.editorialReviewState ?? "unconfirmed",
    verified: listing.verified === true,
    programUrl: listing.programUrl ?? listing.sourceUrl,
    applicationUrl: listing.applicationUrl ?? null,
    deadline: listing.deadline ?? null,
    deadlineType: listing.deadlineType ?? null,
    applicationCycle: listing.applicationCycle ?? null,
    canonicalUrl: `/opportunities/${listing.id}/`,
  }));
  const nextOffset = offset + page.length;
  return json({
    queue: "published-review",
    total: filtered.length,
    count: page.length,
    nextCursor: nextOffset < filtered.length ? btoa(String(nextOffset)) : null,
    listings: page,
  });
}

export async function canonicalListingDetail(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  await requireModerator(request, env);
  const validId = listingId(id);
  const records = await staticRecords<ExportedListing>(
    request,
    env,
    "/data/opportunities.json",
  );
  const listing = records.find((record) => record.id === validId);
  if (!listing)
    return apiError("Listing was not found.", 404, "not_found");
  return json({ listing });
}

export async function createListingUpdate(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env);
  const validId = listingId(id);
  const records = await staticRecords<ExportedListing>(
    request,
    env,
    "/data/opportunities.json",
  );
  const listing = records.find((record) => record.id === validId);
  if (!listing)
    return apiError("Listing was not found.", 404, "not_found");
  const body = asRecord(await readJson(request, 20_000));
  const normalized = normalizedData(body);
  const { data: activeUpdates } = await supabaseRequest<Array<{ id: string }>>(
    env,
    `/rest/v1/opportunity_submissions?submission_kind=eq.listing_update&target_listing_id=eq.${encodeURIComponent(validId)}&status=in.(pending,reviewing,flagged,approved)&select=id&limit=1`,
  );
  if (activeUpdates[0])
    throw new RequestError(
      "This listing already has an update awaiting review or publication.",
      409,
      "listing_update_pending",
    );
  const originalCreatedAt =
    listing.reviewedAt || `${listing.reviewDate}T00:00:00.000Z`;
  const submissionId = await callRpc<string>(env, "create_listing_update", {
    p_moderator_id: moderator.userId,
    p_target_listing_id: validId,
    p_original_created_at: originalCreatedAt,
    p_normalized: normalized,
  });
  return json(
    {
      message:
        "Listing update queued for human review. It will not change Git until separately approved and published.",
      submission_id: submissionId,
      target_listing_id: validId,
    },
    202,
  );
}

const canonicalActionClaims = (
  body: Record<string, unknown>,
): string[] => {
  const value = body.claims_checked;
  if (!Array.isArray(value))
    throw new RequestError("Claims checked are invalid.", 400, "validation_failed");
  return value.map(String);
};

const canonicalActionNormalized = (
  listing: ExportedListing,
  claimsChecked: string[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  if (listing.schemaVersion !== "2.0")
    throw new RequestError(
      "This legacy listing needs the full edit workflow before it can be reviewed.",
      409,
      "full_review_required",
    );
  if (typeof listing.defaultSearchEligible !== "boolean")
    throw new RequestError(
      "Default-search eligibility must be resolved in the full edit workflow first.",
      409,
      "full_review_required",
    );
  const programUrl = listing.programUrl ?? listing.sourceUrl ?? listing.officialUrl;
  const location = listing.global === true
    ? "Global"
    : listing.remote === true
      ? "Remote"
      : listing.physicalLocations?.[0] ?? "";
  return normalizedData({
    normalized: {
      title: listing.title,
      organization: listing.provider,
      primary_category: listing.category,
      categories: [listing.category],
      subcategories: listing.subcategories,
      tags: listing.tags,
      description: listing.description,
      eligibility: listing.eligibility,
      benefits: listing.value,
      location,
      physical_locations: listing.physicalLocations ?? [],
      deadline: listing.deadline ?? "",
      resource_type: listing.resourceType ?? "opportunity",
      default_search_eligible: listing.defaultSearchEligible,
      availability_status: listing.status,
      status_reason: listing.statusReason ?? "",
      deadline_type: listing.deadlineType ?? (listing.deadline ? "fixed" : "unknown"),
      application_cycle: listing.applicationCycle ?? "",
      global: listing.global ?? "unknown",
      remote: listing.remote ?? "unknown",
      countries: listing.countries ?? [],
      program_url: programUrl,
      provider_url: listing.providerUrl ?? "",
      application_url: listing.applicationUrl ?? "",
      claims_checked: claimsChecked,
      next_review_at: listing.nextReviewAt ?? "",
      sponsored: typeof listing.sponsor === "boolean" ? listing.sponsor : "unknown",
      sponsorship_type: listing.sponsorshipType ?? "",
      sponsorship_disclosure: listing.sponsorshipDisclosure ?? "",
      ...overrides,
    },
  });
};

const ensureNoActiveListingUpdate = async (env: Env, id: string): Promise<void> => {
  const { data } = await supabaseRequest<Array<{ id: string }>>(
    env,
    `/rest/v1/opportunity_submissions?submission_kind=eq.listing_update&target_listing_id=eq.${encodeURIComponent(id)}&status=in.(pending,reviewing,flagged,approved)&select=id&limit=1`,
  );
  if (data[0])
    throw new RequestError(
      "This listing already has an update awaiting review or publication.",
      409,
      "listing_update_pending",
    );
};

const reviewedCanonicalUpdate = async (
  env: Env,
  moderator: Moderator,
  listing: ExportedListing,
  normalized: Record<string, unknown>,
  reason: string,
): Promise<{ submissionId: string; actionId: string }> => {
  await ensureNoActiveListingUpdate(env, listing.id);
  const originalCreatedAt =
    listing.createdAt ??
    listing.reviewedAt ??
    (listing.reviewDate ? `${listing.reviewDate}T00:00:00.000Z` : null);
  if (!originalCreatedAt || Number.isNaN(new Date(originalCreatedAt).valueOf()))
    throw new RequestError(
      "The listing creation provenance needs a full edit before quick review.",
      409,
      "full_review_required",
    );
  const submissionId = await callRpc<string>(env, "create_listing_update", {
    p_moderator_id: moderator.userId,
    p_target_listing_id: listing.id,
    p_original_created_at: originalCreatedAt,
    p_normalized: normalized,
  });
  const actionId = await callRpc<string>(env, "perform_moderation_action", {
    p_submission_id: submissionId,
    p_moderator_id: moderator.userId,
    p_action: "approve",
    p_reason: reason,
    p_notes: null,
    p_normalized: normalized,
  });
  return { submissionId, actionId };
};

const canonicalListingForAction = async (
  request: Request,
  env: Env,
  id: string,
): Promise<ExportedListing> => {
  const validId = listingId(id);
  const records = await staticRecords<ExportedListing>(
    request,
    env,
    "/data/opportunities.json",
  );
  const listing = records.find((record) => record.id === validId);
  if (!listing)
    throw new RequestError("Listing was not found.", 404, "not_found");
  return listing;
};

export async function verifyCanonicalListing(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env);
  const listing = await canonicalListingForAction(request, env, id);
  const body = asRecord(await readJson(request, 8_000));
  const claimsChecked = canonicalActionClaims(body);
  const nextReviewAt = typeof body.next_review_at === "string"
    ? body.next_review_at.trim()
    : listing.nextReviewAt ?? "";
  const blockedStatuses = new Set(["unconfirmed", "expired", "disputed", "archived"]);
  if (blockedStatuses.has(listing.status))
    throw new RequestError(
      "Resolve the listing availability in the full edit workflow before verifying it.",
      409,
      "full_review_required",
    );
  const geographyKnown =
    typeof listing.global === "boolean" ||
    typeof listing.remote === "boolean" ||
    Boolean(listing.countries?.length);
  if (!geographyKnown)
    throw new RequestError(
      "Resolve geography in the full edit workflow before verifying this listing.",
      409,
      "full_review_required",
    );
  if (!nextReviewAt)
    throw new RequestError(
      "Choose the next review date before verifying this listing.",
      400,
      "validation_failed",
    );
  const requiredClaims = new Set(["program-exists", "eligibility", "geography"]);
  if (listing.applicationUrl) requiredClaims.add("application-url");
  if (listing.deadlineType === "fixed" && listing.deadline)
    requiredClaims.add("deadline");
  const missingClaims = [...requiredClaims].filter((claim) => !claimsChecked.includes(claim));
  if (missingClaims.length)
    throw new RequestError(
      `Verify the required claims first: ${missingClaims.join(", ")}.`,
      400,
      "verification_incomplete",
    );
  const normalized = canonicalActionNormalized(listing, claimsChecked, {
    next_review_at: nextReviewAt,
  });
  const result = await reviewedCanonicalUpdate(
    env,
    moderator,
    listing,
    normalized,
    "Re-verified current published listing",
  );
  return json(
    {
      message:
        "Verification recorded as an approved canonical update. An administrator can publish it in the next validated data batch.",
      submission_id: result.submissionId,
      action_id: result.actionId,
      target_listing_id: listing.id,
    },
    202,
  );
}

export async function markCanonicalListingInactive(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env);
  const listing = await canonicalListingForAction(request, env, id);
  const body = asRecord(await readJson(request, 8_000));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 4 || reason.length > 1_000)
    throw new RequestError(
      "Explain why the listing is being marked inactive.",
      400,
      "validation_failed",
    );
  const claimsChecked = canonicalActionClaims(body);
  const normalized = canonicalActionNormalized(listing, claimsChecked, {
    availability_status: "archived",
    default_search_eligible: false,
    status_reason: reason,
    next_review_at:
      typeof body.next_review_at === "string"
        ? body.next_review_at.trim()
        : listing.nextReviewAt ?? "",
  });
  const result = await reviewedCanonicalUpdate(
    env,
    moderator,
    listing,
    normalized,
    "Marked current listing inactive after moderator review",
  );
  return json(
    {
      message:
        "Inactive state recorded as an approved canonical update. It will leave default discovery after the validated data batch is published.",
      submission_id: result.submissionId,
      action_id: result.actionId,
      target_listing_id: listing.id,
    },
    202,
  );
}

export async function removeCanonicalListing(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env);
  const listing = await canonicalListingForAction(request, env, id);
  const body = asRecord(await readJson(request, 8_000));
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const notes = optionalNote(body.notes);
  if (reason.length < 4 || reason.length > 240)
    throw new RequestError("Removal reason is required.", 400, "validation_failed");
  const reports = await insertRows<{ id: string }>(env, "listing_reports", {
    listing_id: listing.id,
    reason,
    details: notes
      ? `Moderator-initiated removal. ${notes}`
      : "Moderator-initiated removal from the canonical review workflow.",
    status: "open",
    assigned_to: moderator.userId,
  });
  const reportId = reports[0]?.id;
  if (!reportId)
    throw new RequestError("Removal could not be recorded.", 500, "removal_failed");
  const listingIdValue = await callRpc<string>(env, "resolve_listing_report", {
    p_report_id: reportId,
    p_moderator_id: moderator.userId,
    p_decision: "upheld",
    p_notes: notes ?? reason,
  });
  await deleteListingStateCache(listingIdValue);
  let removalBatch = null;
  try {
    removalBatch = await prepareListingRemovalForReport(env, reportId);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "moderator_listing_removal_prepare_failed",
        report_id: reportId,
        listing_id: listing.id,
        error: error instanceof Error ? error.name : "unknown",
      }),
    );
  }
  return json(
    {
      message:
        "Listing suppressed immediately and queued for validated removal from the public dataset.",
      listing_id: listingIdValue,
      report_id: reportId,
      removal: removalBatch
        ? {
            status: removalBatch.status,
            pull_request_url: removalBatch.github_pr_url,
          }
        : null,
    },
    202,
  );
}

export async function moderationAction(
  request: Request,
  env: Env,
  id: string,
  action: string,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env);
  if (action === "undo") {
    const actionId = await callRpc<string>(env, "undo_moderation_action", {
      p_submission_id: id,
      p_moderator_id: moderator.userId,
    });
    return json({ message: "Previous action undone.", action_id: actionId });
  }
  const { data: statusRows } = await supabaseRequest<Array<{ status: string }>>(
    env,
    `/rest/v1/opportunity_submissions?id=eq.${encodeURIComponent(id)}&select=status&limit=1`,
  );
  const status = statusRows[0]?.status as SubmissionStatus | undefined;
  if (!status || !actionAllowedForStatus(status, action))
    throw new RequestError(
      "This action is not available in the submission's current queue.",
      409,
      "invalid_status_transition",
    );
  const body = asRecord(await readJson(request));
  if (action === "approve")
    return moderate(
      env,
      moderator,
      id,
      action,
      "Approved after review",
      optionalNote(body.notes),
      normalizedData(body),
    );
  if (action === "decline")
    return moderate(
      env,
      moderator,
      id,
      action,
      requiredChoice(body.reason, DECLINE_REASONS, "Reason"),
      optionalNote(body.notes),
    );
  if (action === "flag")
    return moderate(
      env,
      moderator,
      id,
      action,
      requiredChoice(body.reason, FLAG_REASONS, "Reason"),
      optionalNote(body.notes),
    );
  if (action === "unflag")
    return moderate(
      env,
      moderator,
      id,
      action,
      optionalNote(body.reason),
      optionalNote(body.notes),
    );
  if (action === "notes")
    return moderate(env, moderator, id, "note", null, optionalNote(body.notes));
  throw new RequestError("Unknown moderation action.", 404, "not_found");
}

export async function reports(request: Request, env: Env): Promise<Response> {
  await requireModerator(request, env);
  const { data } = await supabaseRequest<unknown[]>(
    env,
    "/rest/v1/listing_reports?status=in.(open,reviewing)&select=id,listing_id,reason,details,reporter_country_code,status,created_at&order=created_at.asc&limit=100",
  );
  return json({ count: data.length, reports: data });
}

export async function resolveReport(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env);
  const body = asRecord(await readJson(request, 8_000));
  const decision = requiredChoice(
    body.decision,
    new Set(["upheld", "dismissed"]),
    "Report decision",
  );
  const listingId = await callRpc<string>(env, "resolve_listing_report", {
    p_report_id: id,
    p_moderator_id: moderator.userId,
    p_decision: decision,
    p_notes: optionalNote(body.notes),
  });
  await deleteListingStateCache(listingId);
  let removalBatch = null;
  if (decision === "upheld") {
    try {
      removalBatch = await prepareListingRemovalForReport(env, id);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "listing_removal_prepare_failed",
          report_id: id,
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
  }
  return json({
    message:
      decision === "upheld"
        ? "Report upheld. The listing is suppressed and queued for validated removal from the public dataset."
        : "Report dismissed; listing retained.",
    listing_id: listingId,
    removal: removalBatch
      ? {
          status: removalBatch.status,
          pull_request_url: removalBatch.github_pr_url,
        }
      : null,
  });
}

const listingId = (value: string): string => {
  if (value.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    throw new RequestError("Listing ID is invalid.", 400, "validation_failed");
  return value;
};

const listingStateCacheRequest = (id: string) =>
  new Request(`https://perkcommons.com/__listing-state-cache/${id}`);

type EdgeCache = Pick<Cache, "match" | "put" | "delete">;
const listingStateCache = (): EdgeCache | null => {
  const runtime = globalThis as typeof globalThis & {
    caches?: CacheStorage & { default?: EdgeCache };
  };
  return runtime.caches?.default ?? null;
};

const deleteListingStateCache = async (id: string): Promise<void> => {
  const cache = listingStateCache();
  if (cache) await cache.delete(listingStateCacheRequest(id));
};

export async function isListingRemoved(env: Env, id: string): Promise<boolean> {
  const validId = listingId(id);
  if (env.TOMBSTONE_STORE) {
    const tombstone = await env.TOMBSTONE_STORE.get(validId);
    if (tombstone !== null) return true;
  }
  const cacheKey = listingStateCacheRequest(validId);
  const cache = listingStateCache();
  const cached = cache ? await cache.match(cacheKey) : undefined;
  if (cached) return (await cached.text()) === "removed";
  try {
    const { data } = await supabaseRequest<Array<{ listing_id: string }>>(
      env,
      `/rest/v1/listing_moderation_state?listing_id=eq.${encodeURIComponent(validId)}&removed=eq.true&select=listing_id&limit=1`,
    );
    const removed = Boolean(data[0]);
    if (cache)
      await cache.put(
        cacheKey,
        new Response(removed ? "removed" : "visible", {
          headers: { "cache-control": "public, max-age=60" },
        }),
      );
    return removed;
  } catch (error) {
    // Static listings remain available during a database or migration outage.
    if (error instanceof SupabaseError) {
      console.warn(
        JSON.stringify({
          event: "listing_suppression_check_failed",
          status: error.status,
          database_code: error.databaseCode,
        }),
      );
      return false;
    }
    throw error;
  }
}

export async function publicListingState(
  request: Request,
  env: Env,
): Promise<Response> {
  const requested = new URL(request.url).searchParams.getAll("id");
  const ids = [...new Set(requested.map(listingId))];
  if (ids.length === 0)
    throw new RequestError("At least one listing ID is required.", 400, "validation_failed");
  if (ids.length > 100)
    throw new RequestError("At most 100 listing IDs may be requested.", 400, "validation_failed");
  const { data } = await supabaseRequest<
    Array<{ listing_id: string; featured: boolean; removed: boolean }>
  >(
    env,
    `/rest/v1/listing_moderation_state?listing_id=in.(${ids.join(",")})&or=(featured.eq.true,removed.eq.true)&select=listing_id,featured,removed`,
  );
  const body = JSON.stringify({ listings: data });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const etag = `"${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}"`;
  if (request.headers.get("if-none-match") === etag)
    return new Response(null, {
      status: 304,
      headers: { etag, "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300" },
    });
  return new Response(body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30, s-maxage=60, stale-while-revalidate=300",
      etag,
      "x-content-type-options": "nosniff",
    },
  });
}

export async function featureListing(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env);
  const body = asRecord(await readJson(request, 2_000));
  if (typeof body.featured !== "boolean")
    throw new RequestError("Featured state is required.", 400, "validation_failed");
  await callRpc<void>(env, "set_listing_featured", {
    p_listing_id: listingId(id),
    p_moderator_id: moderator.userId,
    p_featured: body.featured,
  });
  return json({ message: body.featured ? "Listing featured." : "Feature removed." });
}

export async function purgeRejected(
  request: Request,
  env: Env,
  id: string | null,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env);
  const count = await callRpc<number>(env, "purge_rejected_submissions", {
    p_moderator_id: moderator.userId,
    p_submission_id: id,
  });
  return json({ message: `${count} rejected submission${count === 1 ? "" : "s"} deleted.`, count });
}

export async function publications(
  request: Request,
  env: Env,
): Promise<Response> {
  const administrator = await requireModerator(request, env, "admin");
  if (request.method === "GET") return json(await publicationBatchStatus(env));
  assertSameOrigin(request);
  const batch = await startPublicationBatch(env, administrator);
  if (!batch)
    return json({
      message: "There are no approved submissions ready to publish.",
      batch: null,
      approved_count: 0,
    });
  return json(
    {
      message: `${batch.item_count} approved submission${batch.item_count === 1 ? "" : "s"} queued for validated publication.`,
      batch,
      approved_count: batch.item_count,
    },
    202,
  );
}

export async function moderators(
  request: Request,
  env: Env,
): Promise<Response> {
  const administrator = await requireModerator(request, env, "admin");
  if (request.method === "GET") {
    const { data } = await supabaseRequest<unknown[]>(
      env,
      "/rest/v1/moderator_profiles?select=user_id,role,active,created_at,updated_at&order=created_at.asc",
    );
    return json({ moderators: data });
  }
  assertSameOrigin(request);
  const body = asRecord(await readJson(request, 8_000));
  if (
    typeof body.user_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.user_id,
    )
  )
    throw new RequestError("User ID is invalid.", 400, "validation_failed");
  const role = requiredChoice(
    body.role,
    new Set(["reviewer", "admin"]),
    "Role",
  );
  const active = body.active !== false;
  await supabaseRequest(
    env,
    "/rest/v1/moderator_profiles?on_conflict=user_id",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ user_id: body.user_id, role, active }),
    },
  );
  await insertRows(env, "moderation_actions", {
    moderator_id: administrator.userId,
    action: "moderator_update",
    reason: `${role}:${active ? "active" : "inactive"}`,
    metadata: { user_id: body.user_id },
  });
  return json({ message: "Moderator profile updated." });
}

export async function createBan(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env, "admin");
  const body = asRecord(await readJson(request));
  const type = requiredChoice(
    body.identifier_type,
    new Set(["email", "ip", "both"]),
    "Identifier type",
  );
  const mode = requiredChoice(
    body.mode ?? "block",
    new Set(["block", "flag", "warn"]),
    "Ban mode",
  );
  const reason =
    typeof body.reason === "string"
      ? body.reason.trim().slice(0, 300)
      : "Abusive submissions";
  if (typeof body.submission_id !== "string")
    throw new RequestError("Submission is required.", 400, "validation_failed");
  const { data } = await supabaseRequest<
    Array<{
      submission_email_hash: string | null;
      submission_ip_hash: string | null;
      submitter_email: string | null;
    }>
  >(
    env,
    `/rest/v1/opportunity_submissions?id=eq.${encodeURIComponent(body.submission_id)}&select=submission_email_hash,submission_ip_hash,submitter_email&limit=1`,
  );
  const submission = data[0];
  const emailHash = submission?.submission_email_hash ?? null;
  const ipHash = submission?.submission_ip_hash ?? null;
  if (
    ((type === "email" || type === "both") && !emailHash) ||
    ((type === "ip" || type === "both") && !ipHash)
  )
    throw new RequestError(
      "This submission has no matching fingerprint.",
      400,
      "fingerprint_unavailable",
    );
  const durationHours =
    typeof body.duration_hours === "number" ? body.duration_hours : null;
  let expiresAt =
    durationHours && durationHours > 0
      ? new Date(
          Date.now() + Math.min(durationHours, 24 * 365 * 10) * 3_600_000,
        ).toISOString()
      : null;
  if (typeof body.expires_at === "string" && body.expires_at) {
    const customExpiry = new Date(body.expires_at);
    if (
      !Number.isFinite(customExpiry.getTime()) ||
      customExpiry.getTime() <= Date.now() ||
      customExpiry.getTime() > Date.now() + 10 * 365 * 24 * 3_600_000
    )
      throw new RequestError(
        "Custom expiry is invalid.",
        400,
        "validation_failed",
      );
    expiresAt = customExpiry.toISOString();
  }
  const emailHint = submission?.submitter_email
    ? maskEmail(submission.submitter_email)
    : "Email fingerprint";
  const ipHint = ipHash
    ? `Network fingerprint ...${ipHash.slice(-6)}`
    : "Network fingerprint";
  await callRpc<string[]>(env, "create_submission_bans", {
    p_submission_id: body.submission_id,
    p_moderator_id: moderator.userId,
    p_identifier_type: type,
    p_email_hash: emailHash,
    p_ip_hash: ipHash,
    p_email_hint: emailHint,
    p_ip_hint: ipHint,
    p_reason: reason,
    p_notes: optionalNote(body.notes),
    p_mode: mode,
    p_expires_at: expiresAt,
  });
  return json({ message: "Abuse control created." }, 201);
}

export async function bans(request: Request, env: Env): Promise<Response> {
  await requireModerator(request, env, "admin");
  const { data } = await supabaseRequest<unknown[]>(
    env,
    "/rest/v1/moderation_bans?active=eq.true&select=id,identifier_type,display_hint,reason,mode,created_at,expires_at&order=created_at.desc&limit=100",
  );
  return json({ bans: data });
}

export async function removeBan(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env, "admin");
  await callRpc<string>(env, "disable_moderation_ban", {
    p_ban_id: id,
    p_moderator_id: moderator.userId,
  });
  return json({ message: "Abuse control removed." });
}

export const moderationError = (error: unknown): Response => {
  if (error instanceof RequestError)
    return apiError(error.message, error.status, error.code);
  console.error(
    JSON.stringify({
      event: "moderation_api_failed",
      error: error instanceof Error ? error.name : "unknown",
    }),
  );
  return apiError(
    "The moderation service is temporarily unavailable.",
    503,
    "service_unavailable",
  );
};
