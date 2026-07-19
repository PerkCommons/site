export type ModeratorRole = "reviewer" | "admin";
export type SubmissionStatus =
  | "pending"
  | "reviewing"
  | "flagged"
  | "approved"
  | "rejected"
  | "published"
  | "withdrawn";

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUBMISSION_FINGERPRINT_SECRET: string;
  GITHUB_DATA_PUBLICATION_TOKEN?: string;
  GITHUB_SITE_DEPLOY_TOKEN?: string;
  TURNSTILE_SECRET_KEY?: string;
  SUBMISSION_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
}

export interface Moderator {
  userId: string;
  email: string;
  role: ModeratorRole;
}

export interface SubmissionInput {
  organization: string;
  name: string;
  primary_category: string;
  subcategories: string[];
  tags: string[];
  categories: string[];
  source_url: string;
  organization_website_url: string | null;
  description: string;
  eligibility: string;
  benefits: string | null;
  location: string | null;
  deadline: string | null;
  submitter_name: string | null;
  submitter_email: string | null;
  submitter_notes: string | null;
  affiliation_confirmed: true;
  website: string;
  turnstile_token: string | null;
}
