import assert from "node:assert/strict";
import test from "node:test";
import { supabaseRequest } from "../lib/supabase";
import type { Env } from "../lib/types";

const env = {
  SUPABASE_URL: "https://target.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "publishable",
  SUPABASE_SERVICE_ROLE_KEY: "legacy-jwt",
  SUBMISSION_FINGERPRINT_SECRET: "fingerprint",
} satisfies Env;

test("legacy JWT service role is sent as apikey and bearer", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), "legacy-jwt");
    assert.equal(headers.get("authorization"), "Bearer legacy-jwt");
    return Response.json([]);
  };
  try {
    const response = await supabaseRequest<unknown[]>(env, "/rest/v1/opportunity_submissions?select=id&limit=1");
    assert.deepEqual(response.data, []);
  } finally { globalThis.fetch = original; }
});

test("modern sb_secret service role must not be sent as bearer JWT", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), "sb_secret_test-only");
    assert.equal(headers.get("authorization"), null);
    return Response.json([]);
  };
  try {
    const response = await supabaseRequest<unknown[]>(
      { ...env, SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test-only" },
      "/rest/v1/opportunity_submissions?select=id&limit=1",
    );
    assert.deepEqual(response.data, []);
  } finally { globalThis.fetch = original; }
});
