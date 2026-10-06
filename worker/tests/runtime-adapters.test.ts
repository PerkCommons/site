import assert from "node:assert/strict";
import test from "node:test";
import { listingIdFromPath } from "../../middleware";
import { createNoopEdgeCache } from "../../vercel/runtime-compat";
import { vercelEnv } from "../../vercel/runtime-env";
import { routeApiRequest } from "../lib/api-router";
import { isListingRemovedWithoutEdgeCache } from "../lib/listing-state";
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
    new Request("https://next.example/api/does-not-exist"),
    baseEnv(),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: { code: "not_found", message: "API route not found." },
  });
});

test("Vercel headers provide client metadata", () => {
  const request = new Request("https://next.example/api/submissions", {
    headers: {
      "x-forwarded-for": "203.0.113.40",
      "x-vercel-ip-country": "PL",
    },
  });
  assert.equal(requestClientIp(request), "203.0.113.40");
  assert.equal(requestCountry(request), "PL");
});

test("Cloudflare headers remain supported", () => {
  const request = new Request("https://next.example/api/submissions", {
    headers: {
      "cf-connecting-ip": "198.51.100.4",
      "cf-ipcountry": "DE",
    },
  });
  assert.equal(requestClientIp(request), "198.51.100.4");
  assert.equal(requestCountry(request), "DE");
});

test("Vercel environment requires server Supabase values", () => {
  assert.throws(() => vercelEnv({ VERCEL: "1" }), /SUPABASE_URL/);
});

test("Vercel adapter defaults to the canonical organization targets", () => {
  const result = vercelEnv({
    VERCEL: "1",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    SUBMISSION_FINGERPRINT_SECRET: "0123456789abcdef0123456789abcdef",
  });
  assert.equal(result.GITHUB_DATA_REPOSITORY, "PerkCommons/data");
  assert.equal(result.GITHUB_DATA_BRANCH, "main");
  assert.equal(result.GITHUB_HEAD_OWNER, "PerkCommons");
  assert.equal(result.FORK_ONLY_MODE, "false");
});

test("Vercel adapter maps production identity and Turnstile site key", () => {
  const result = vercelEnv({
    VERCEL: "1",
    VERCEL_ENV: "production",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    SUBMISSION_FINGERPRINT_SECRET: "0123456789abcdef0123456789abcdef",
    PUBLIC_TURNSTILE_SITE_KEY: "site-key",
    TURNSTILE_SECRET_KEY: "secret-key",
  });
  assert.equal(result.ENVIRONMENT, "production");
  assert.equal(result.TURNSTILE_SITE_KEY, "site-key");
  assert.equal(result.TURNSTILE_SECRET_KEY, "secret-key");
});

test("Vercel preview maps to development environment", () => {
  const result = vercelEnv({
    VERCEL: "1",
    VERCEL_ENV: "preview",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "public",
    SUPABASE_SERVICE_ROLE_KEY: "service",
    SUBMISSION_FINGERPRINT_SECRET: "0123456789abcdef0123456789abcdef",
  });
  assert.equal(result.ENVIRONMENT, "development");
});

test("Vercel adapter can opt into the legacy fork-only guard", () => {
  assert.throws(
    () =>
      vercelEnv({
        VERCEL: "1",
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_PUBLISHABLE_KEY: "public",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        SUBMISSION_FINGERPRINT_SECRET:
          "0123456789abcdef0123456789abcdef",
        GITHUB_DATA_REPOSITORY: "PerkCommons/data",
        FORK_ONLY_MODE: "true",
      }),
    /fork-only/i,
  );
});

test("listing path parser ignores the directory index", () => {
  assert.equal(listingIdFromPath("/opportunities/"), null);
});

test("listing path parser accepts one stable listing slug", () => {
  assert.equal(
    listingIdFromPath("/opportunities/example-grant/"),
    "example-grant",
  );
});

test("Vercel tombstone lookup works without the Cloudflare Cache API", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    assert.match(url, /listing_moderation_state/);
    return Response.json([{ listing_id: "removed-example" }]);
  };

  try {
    assert.equal(
      await isListingRemovedWithoutEdgeCache(baseEnv(), "removed-example"),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Vercel cache compatibility is deliberately non-persistent", async () => {
  const cache = createNoopEdgeCache();
  const request = new Request("https://next.example/__listing-state-cache/test");
  assert.equal(await cache.match(request), undefined);
  await cache.put(request, new Response("removed"));
  assert.equal(await cache.match(request), undefined);
  assert.equal(await cache.delete(request), false);
});