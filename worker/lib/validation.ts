import type { SubmissionInput } from "./types";
import { RequestError } from "./http";
import {
  CATEGORY_IDS,
  isSubcategoryFor,
  normalizeCategoryId,
} from "../../src/lib/taxonomy";

export const ALLOWED_CATEGORIES = new Set<string>(CATEGORY_IDS);

const REPORT_REASONS = new Set([
  "Expired",
  "Broken link",
  "Incorrect information",
  "Possible scam",
  "Duplicate",
  "Privacy concern",
  "Other",
]);

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestError(
      "Request body must be an object.",
      400,
      "invalid_payload",
    );
  }
  return value as Record<string, unknown>;
};

const requiredText = (
  value: unknown,
  name: string,
  min: number,
  max: number,
): string => {
  if (typeof value !== "string")
    throw new RequestError(`${name} is required.`, 400, "validation_failed");
  const result = value.trim();
  if (result.length < min || result.length > max)
    throw new RequestError(`${name} is invalid.`, 400, "validation_failed");
  return result;
};

const optionalText = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string")
    throw new RequestError(
      "An optional field is invalid.",
      400,
      "validation_failed",
    );
  const result = value.trim();
  if (result.length > max)
    throw new RequestError(
      "An optional field is too long.",
      400,
      "validation_failed",
    );
  return result || null;
};

export const normalizeEmail = (value: unknown): string | null => {
  const email = optionalText(value, 254)?.toLowerCase() ?? null;
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new RequestError(
      "Email address is invalid.",
      400,
      "validation_failed",
    );
  return email;
};

export const safeHttpsUrl = (
  value: unknown,
  name: string,
  required = true,
): string | null => {
  const text = required
    ? requiredText(value, name, 1, 500)
    : optionalText(value, 500);
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new RequestError(
      `${name} must be a valid URL.`,
      400,
      "validation_failed",
    );
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new RequestError(
      `${name} must use a safe HTTPS URL.`,
      400,
      "validation_failed",
    );
  }
  return url.toString();
};

export const normalizeCountryCode = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
};

export function validateSubmission(value: unknown): SubmissionInput {
  const data = record(value);
  const legacyCategories = Array.isArray(data.categories)
    ? data.categories
    : [];
  const primaryCategory = normalizeCategoryId(
    data.primary_category ?? data.category ?? legacyCategories[0],
  );
  const subcategories = data.subcategories ?? [];
  const tags = data.tags ?? [];
  if (
    !primaryCategory ||
    !Array.isArray(subcategories) ||
    subcategories.length > 8 ||
    subcategories.some(
      (subcategory) => !isSubcategoryFor(primaryCategory, subcategory),
    ) ||
    new Set(subcategories).size !== subcategories.length
  ) {
    throw new RequestError(
      "Choose a valid category and matching subcategories.",
      400,
      "validation_failed",
    );
  }
  if (
    !Array.isArray(tags) ||
    tags.length > 12 ||
    tags.some(
      (tag) =>
        typeof tag !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag),
    ) ||
    new Set(tags).size !== tags.length
  ) {
    throw new RequestError("Tags are invalid.", 400, "validation_failed");
  }
  if (data.affiliation_confirmed !== true)
    throw new RequestError(
      "Affiliation disclosure is required.",
      400,
      "validation_failed",
    );
  const deadline = optionalText(data.deadline, 10);
  if (deadline && !/^\d{4}-\d{2}-\d{2}$/.test(deadline))
    throw new RequestError("Deadline is invalid.", 400, "validation_failed");

  return {
    organization: requiredText(data.organization, "Organization", 1, 100),
    name: requiredText(data.name, "Opportunity title", 1, 140),
    primary_category: primaryCategory,
    subcategories: subcategories as string[],
    tags: tags as string[],
    categories: [primaryCategory],
    source_url: safeHttpsUrl(data.source_url, "Official source") as string,
    organization_website_url: safeHttpsUrl(
      data.organization_website_url,
      "Organization website",
      false,
    ),
    description: requiredText(data.description, "Description", 30, 2_000),
    eligibility: requiredText(data.eligibility, "Eligibility", 20, 2_000),
    benefits: optionalText(data.benefits, 2_000),
    location: optionalText(data.location, 120),
    deadline,
    submitter_name: optionalText(data.submitter_name, 100),
    submitter_email: normalizeEmail(data.submitter_email),
    submitter_notes: optionalText(data.submitter_notes, 1_000),
    affiliation_confirmed: true,
    website: optionalText(data.website, 200) ?? "",
    turnstile_token: optionalText(data.turnstile_token, 2_048),
  };
}

export interface ReportInput {
  listing_id: string;
  reason: string;
  details: string | null;
  reporter_email: string | null;
  website: string;
  turnstile_token: string | null;
}

export function validateReport(value: unknown): ReportInput {
  const data = record(value);
  const reason = requiredText(data.reason, "Reason", 1, 80);
  if (!REPORT_REASONS.has(reason))
    throw new RequestError(
      "Choose a valid report reason.",
      400,
      "validation_failed",
    );
  return {
    listing_id: requiredText(data.listing_id, "Listing", 1, 160),
    reason,
    details: optionalText(data.details, 1_500),
    reporter_email: normalizeEmail(data.reporter_email),
    website: optionalText(data.website, 200) ?? "",
    turnstile_token: optionalText(data.turnstile_token, 2_048),
  };
}

export const requiredChoice = (
  value: unknown,
  allowed: ReadonlySet<string>,
  label: string,
): string => {
  const choice = requiredText(value, label, 1, 100);
  if (!allowed.has(choice))
    throw new RequestError(`${label} is invalid.`, 400, "validation_failed");
  return choice;
};

export const optionalNote = (value: unknown): string | null =>
  optionalText(value, 2_000);
