import {
  categories,
  normalizeCategoryId,
  subcategoryLabel,
  type CategoryId,
} from "./taxonomy";

export interface ModerationSubmission {
  id: string;
  name: string;
  organization: string;
  categories: string[];
  primary_category: string | null;
  subcategories: string[];
  tags: string[];
  description: string;
  eligibility: string;
  benefits: string | null;
  location: string | null;
  deadline: string | null;
  source_url: string;
  organization_website_url: string | null;
  submitter_name: string | null;
  submitter_email: string | null;
  submitter_notes: string | null;
  status: string;
  risk_score: number;
  flag_count: number;
  submission_country_code: string | null;
  created_at: string;
  updated_at?: string;
  reviewed_at: string | null;
  published_at: string | null;
  last_action_at?: string | null;
  decision_reason: string | null;
}

export interface ModerationContext {
  flags?: Array<{
    reason: string;
    notes?: string | null;
    resolved?: boolean;
    created_at?: string;
  }>;
  actions?: Array<{
    action: string;
    reason?: string | null;
    notes?: string | null;
    previous_status?: string | null;
    new_status?: string | null;
    created_at: string;
  }>;
  duplicateCount?: number;
}

export function countryName(
  code: string | null | undefined,
  locale = "en",
): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "Unknown country";
  try {
    return (
      new Intl.DisplayNames([locale], { type: "region" }).of(
        code.toUpperCase(),
      ) ?? "Unknown country"
    );
  } catch {
    return "Unknown country";
  }
}

export function countryFlag(code: string | null | undefined): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  return [...code.toUpperCase()]
    .map((character) => String.fromCodePoint(127397 + character.charCodeAt(0)))
    .join("");
}

const value = (input: string | null | undefined): string =>
  input?.trim() || "Not provided";
const list = (items: string[]): string =>
  items.length ? items.join(", ") : "Not provided";

export function moderationCategory(
  submission: ModerationSubmission,
): CategoryId | null {
  return normalizeCategoryId(
    submission.primary_category ?? submission.categories[0],
  );
}

export function buildReviewBrief(
  submission: ModerationSubmission,
  context: ModerationContext = {},
  redacted = false,
): string {
  const country = countryName(submission.submission_country_code);
  const category = moderationCategory(submission);
  const categoryText = category
    ? `${categories[category]} (${category})`
    : "Not provided";
  const subcategoryText = category
    ? submission.subcategories.map((item) => subcategoryLabel(category, item))
    : submission.subcategories;
  const sourceDomain = (() => {
    try {
      return new URL(submission.source_url).hostname;
    } catch {
      return "Invalid source URL";
    }
  })();
  const activeFlags =
    context.flags
      ?.filter((flag) => !flag.resolved)
      .map((flag) => flag.reason) ?? [];
  const previousApproved =
    context.actions?.filter((action) => action.new_status === "approved")
      .length ?? 0;
  const previousRejected =
    context.actions?.filter((action) => action.new_status === "rejected")
      .length ?? 0;
  const submitter = redacted
    ? "Private submitter details redacted"
    : `Name: ${value(submission.submitter_name)}\nEmail: ${value(submission.submitter_email)}\nNotes: ${value(submission.submitter_notes)}`;

  return `# PerkCommons moderation review

Submission ID: ${submission.id}
Submitted: ${submission.created_at}
Status: ${submission.status}
Submission country: ${country}${submission.submission_country_code ? ` (${submission.submission_country_code})` : ""}

## Opportunity
Name: ${submission.name}
Organization: ${submission.organization}
Primary category: ${categoryText}
Subcategories: ${list(subcategoryText)}
Tags: ${list(submission.tags)}
Location: ${value(submission.location)}
Deadline: ${value(submission.deadline)}

## Description
${submission.description}

## Eligibility
${submission.eligibility}

## Benefits
${value(submission.benefits)}

## Sources
Official source: ${submission.source_url}
Organization website: ${value(submission.organization_website_url)}

## Submitter
${submitter}

## Moderation signals
- Country: ${country}${submission.submission_country_code ? ` (${submission.submission_country_code})` : ""}
- Source domain: ${sourceDomain}
- Possible duplicates: ${context.duplicateCount ?? "Not checked"}
- Previous approved submissions: ${previousApproved}
- Previous rejected submissions: ${previousRejected}
- Active flags: ${activeFlags.length ? activeFlags.join(", ") : "None"}
- Risk indicators: ${submission.risk_score > 0 ? "Automated review recommended" : "None recorded"}

## Requested analysis
Assess whether this opportunity appears legitimate, whether the submitted
details are supported by the linked sources, and identify inaccuracies,
missing information, risks, conflicts, or reasons it should not be published.`;
}

export function buildPublicationData(submission: ModerationSubmission): string {
  const category = moderationCategory(submission);
  return `---
title: ${JSON.stringify(submission.name)}
provider: ${JSON.stringify(submission.organization)}
category: ${JSON.stringify(category ?? "")}
subcategories: ${JSON.stringify(submission.subcategories)}
tags: ${JSON.stringify(submission.tags)}
description: ${JSON.stringify(submission.description)}
eligibility: ${JSON.stringify(submission.eligibility)}
value: ${JSON.stringify(submission.benefits ?? "")}
sourceUrl: ${JSON.stringify(submission.source_url)}
officialUrl: ${JSON.stringify(submission.organization_website_url ?? submission.source_url)}
status: active
submissionType: community
sponsor: false
---`;
}
