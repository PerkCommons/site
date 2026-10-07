import assert from "node:assert/strict";
import test from "node:test";
import { routeApiRequest } from "../lib/api-router";
import { requestClientIp, requestCountry } from "../lib/request-metadata";
import type { Env } from "../lib/types";

const baseEnv = (): Env => ({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "public",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SUBMISSION_FINGERPRINT_SECRET: "0123456789abcdef0123456789abcdef",
  GITHUB_DATA_REPOSITORY: "PerkCommons/data",
  GITHUB_DATA_BRANCH: "main",
  GITHUB_HEAD_OWNER: "PerkCommons",
  FORK_ONLY_MODE: "false",
});

test("shared API router preserves unknown-route JSON contract", async () => {
  const response = await routeApiRequest(
    new Request("https://perkcommons.com/api/does-not-exist"),
    baseEnv(),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "not_found", message: "API route not found." },
  });
});

test("generic forwarded IP remains available as a fallback", () => {
  const request = new Request("https://perkcommons.com/api/submissions", {
    headers: { "x-forwarded-for": "203.0.113.40" },
  });
  assert.equal(requestClientIp(request), "203.0.113.40");
});

test("Cloudflare headers provide authoritative client metadata", () => {
  const request = new Request("https://perkcommons.com/api/submissions", {
    headers: {
      "cf-connecting-ip": "198.51.100.4",
      "cf-ipcountry": "DE",
    },
  });
  assert.equal(requestClientIp(request), "198.51.100.4");
  assert.equal(requestCountry(request), "DE");
});
