import { githubTargetConfig } from "../worker/lib/github-targets.js";
import type { Env } from "../worker/lib/types.js";

type EnvironmentSource = Record<string, string | undefined>;

const required = (source: EnvironmentSource, name: string): string => {
  const value = source[name]?.trim();
  if (!value) {
    throw new Error(`Missing required Vercel environment variable: ${name}`);
  }
  return value;
};

const optional = (
  source: EnvironmentSource,
  name: string,
): string | undefined => source[name]?.trim() || undefined;

export function vercelEnv(
  source: EnvironmentSource = process.env,
): Env {
  const vercelEnvironment = optional(source, "VERCEL_ENV");
  const explicitEnvironment = optional(source, "ENVIRONMENT");
  const environment: Env["ENVIRONMENT"] =
    vercelEnvironment === "production"
      ? "production"
      : vercelEnvironment === "preview" || vercelEnvironment === "development"
        ? "development"
        : explicitEnvironment === "production" ||
            explicitEnvironment === "test" ||
            explicitEnvironment === "development"
          ? explicitEnvironment
          : undefined;

  const env: Env = {
    SUPABASE_URL: required(source, "SUPABASE_URL"),
    SUPABASE_PUBLISHABLE_KEY: required(source, "SUPABASE_PUBLISHABLE_KEY"),
    SUPABASE_SERVICE_ROLE_KEY: required(source, "SUPABASE_SERVICE_ROLE_KEY"),
    SUBMISSION_FINGERPRINT_SECRET: required(
      source,
      "SUBMISSION_FINGERPRINT_SECRET",
    ),
    GITHUB_DATA_REPOSITORY:
      optional(source, "GITHUB_DATA_REPOSITORY") ?? "PerkCommons/data",
    GITHUB_DATA_BRANCH: optional(source, "GITHUB_DATA_BRANCH") ?? "main",
    GITHUB_HEAD_OWNER: optional(source, "GITHUB_HEAD_OWNER") ?? "PerkCommons",
    FORK_ONLY_MODE: optional(source, "FORK_ONLY_MODE") ?? "false",
  };

  if (environment) env.ENVIRONMENT = environment;

  const turnstileSiteKey =
    optional(source, "TURNSTILE_SITE_KEY") ??
    optional(source, "PUBLIC_TURNSTILE_SITE_KEY");
  if (turnstileSiteKey) env.TURNSTILE_SITE_KEY = turnstileSiteKey;

  const turnstileSecret = optional(source, "TURNSTILE_SECRET_KEY");
  if (turnstileSecret) env.TURNSTILE_SECRET_KEY = turnstileSecret;

  const publicationToken = optional(source, "GITHUB_DATA_PUBLICATION_TOKEN");
  if (publicationToken) env.GITHUB_DATA_PUBLICATION_TOKEN = publicationToken;

  const siteRepository = optional(source, "GITHUB_SITE_REPOSITORY");
  if (siteRepository) env.GITHUB_SITE_REPOSITORY = siteRepository;

  const siteDeployToken = optional(source, "GITHUB_SITE_DEPLOY_TOKEN");
  if (siteDeployToken) env.GITHUB_SITE_DEPLOY_TOKEN = siteDeployToken;

  const cronSecret = optional(source, "CRON_SECRET");
  if (cronSecret) env.CRON_SECRET = cronSecret;

  githubTargetConfig(env);
  return env;
}