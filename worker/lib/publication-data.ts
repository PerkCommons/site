export interface PublicationPayload {
  submission_id: string;
  title: string;
  organization: string;
  primary_category: string;
  subcategories: string[];
  tags: string[];
  description: string;
  eligibility: string;
  benefits: string | null;
  location: string | null;
  deadline: string | null;
  source_url: string;
  organization_website_url: string | null;
}

export interface PublishedOpportunity {
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
  status: "active";
  submissionType: "community";
  sponsor: false;
  reviewDate: string;
  regions: string[];
  notes?: string;
}

const clip = (value: string, maximum: number): string => {
  const normalized = value.trim();
  if (normalized.length <= maximum) return normalized;
  const candidate = normalized.slice(0, maximum - 3);
  const wordBoundary = candidate.lastIndexOf(" ");
  return `${candidate.slice(0, wordBoundary > maximum * 0.7 ? wordBoundary : undefined).trimEnd()}...`;
};

const slugPart = (value: string): string =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const publicationListingId = (payload: PublicationPayload): string => {
  const suffix = payload.submission_id.replaceAll("-", "").slice(0, 8);
  const base = slugPart(`${payload.organization}-${payload.title}`) || "opportunity";
  return `${base.slice(0, 71).replace(/-+$/g, "")}-${suffix}`;
};

export const toPublishedOpportunity = (
  payload: PublicationPayload,
  reviewDate: string,
): PublishedOpportunity => {
  const opportunity: PublishedOpportunity = {
    id: publicationListingId(payload),
    provider: clip(payload.organization, 100),
    title: clip(payload.title, 140),
    category: payload.primary_category,
    subcategories: payload.subcategories,
    tags: payload.tags,
    description: clip(payload.description, 2_000),
    eligibility: clip(payload.eligibility, 2_000),
    value: clip(
      payload.benefits || "See the official source for current benefits.",
      2_000,
    ),
    sourceUrl: payload.source_url,
    officialUrl: payload.organization_website_url || payload.source_url,
    status: "active",
    submissionType: "community",
    sponsor: false,
    reviewDate,
    regions: [clip(payload.location || "Global", 120)],
  };
  if (payload.deadline)
    opportunity.notes = `Submitted application deadline: ${payload.deadline}.`;
  return opportunity;
};
