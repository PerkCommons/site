import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

interface RateLimitConfig {
  namespace_id: string;
}

interface WorkerEnvironment {
  name?: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: unknown[];
  vars?: Record<string, string>;
  secrets?: { required?: string[] };
  triggers?: { crons?: string[] };
  ratelimits?: RateLimitConfig[];
}

interface WranglerConfig {
  name: string;
  vars?: Record<string, string>;
  ratelimits?: RateLimitConfig[];
  env?: Record<string, WorkerEnvironment>;
}

const config = JSON.parse(
  await readFile(new URL("../../wrangler.jsonc", import.meta.url), "utf8"),
) as WranglerConfig;
const staticHeaders = await readFile(
  new URL("../../public/_headers", import.meta.url),
  "utf8",
);

test("production Worker targets the official PerkCommons repositories", () => {
  assert.equal(config.name, "perkcommons-site");
  assert.equal(config.vars?.ENVIRONMENT, "production");
  assert.equal(config.vars?.GITHUB_DATA_REPOSITORY, "PerkCommons/data");
  assert.equal(config.vars?.GITHUB_SITE_REPOSITORY, "PerkCommons/site");
  assert.equal(config.vars?.FORK_ONLY_MODE, "false");
});

test("development Worker is isolated from production routes and automation", () => {
  const development = config.env?.dev;
  assert.ok(development);
  assert.equal(development.name, "perkcommons-site-dev");
  assert.equal(development.workers_dev, true);
  assert.equal(development.preview_urls, true);
  assert.equal(development.routes, undefined);
  assert.deepEqual(development.triggers?.crons, []);
  assert.equal(development.vars?.ENVIRONMENT, "test");
});

test("development Worker uses distinct rate-limit namespaces", () => {
  const rootIds = new Set(
    (config.ratelimits ?? []).map((binding) => binding.namespace_id),
  );
  const developmentIds = (config.env?.dev?.ratelimits ?? []).map(
    (binding) => binding.namespace_id,
  );
  assert.equal(new Set(developmentIds).size, 4);
  assert.equal(developmentIds.some((id) => rootIds.has(id)), false);
});

test("development Worker requires only isolated runtime secrets", () => {
  assert.deepEqual(config.env?.dev?.secrets?.required, [
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUBMISSION_FINGERPRINT_SECRET",
  ]);
  assert.equal(
    config.env?.dev?.secrets?.required?.some((name) =>
      name.startsWith("GITHUB_")
    ),
    false,
  );
});

test("static assets receive the central security-header policy", () => {
  for (const header of [
    "Content-Security-Policy-Report-Only",
    "Referrer-Policy",
    "Permissions-Policy",
    "X-Content-Type-Options",
    "Strict-Transport-Security",
    "Cross-Origin-Opener-Policy",
  ]) {
    assert.match(staticHeaders, new RegExp(`^\\s*${header}:`, "m"));
  }
  assert.match(staticHeaders, /https:\/\/challenges\.cloudflare\.com/);
  assert.match(staticHeaders, /https:\/\/\*\.supabase\.co/);
});
