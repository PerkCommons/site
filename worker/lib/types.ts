export type ModeratorRole = "reviewer" | "admin";
export type SubmissionStatus =
  | "pending"
  | "reviewing"
  | "flagged"
  | "approved"
  | "rejected"
  | "published"
  | "withdrawn";

interface TombstoneStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

export interface Env {
  ASSETS?: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUBMISSION_FINGERPRINT_SECRET: string;
  GITHUB_DATA_PUBLICATION_TOKEN?: string;
  GITHUB_SITE_DEPLOY_TOKEN?: string;
  GITHUB_DATA_REPOSITORY?: string;
  GITHUB_DATA_BRANCH?: string;
  GITHUB_HEAD_OWNER?: string;
  GITHUB_SITE_REPOSITORY?: string;
  FORK_ONLY_MODE?: string;
  CRON_SECRET?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  ENVIRONMENT?: "development" | "test" | "production";
  TOMBSTONE_STORE?: TombstoneStore;
  SUBMISSION_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  REPORT_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  LOGIN_RATE_LIMITER?: {
    limit(options: { key: string }): Promise<{ success: boolean }>;
  };
  TRACKING_RATE_LIMITER?: {
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