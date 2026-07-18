import assert from "node:assert/strict";
import test from "node:test";
import worker from "../index";
import type { Env } from "../lib/types";

const submission = {
  organization: "Example Foundation",
  name: "Example opportunity",
  primary_category: "funding",
  subcategories: ["grants"],
  tags: ["open-source"],
  source_url: "https://example.com/opportunity",
  organization_website_url: null,
  description: "A sufficiently detailed description for server validation.",
  eligibility: "Eligible applicants meet the published requirements.",
  benefits: null,
  location: null,
  deadline: null,
  submitter_name: null,
  submitter_email: null,
  submitter_notes: null,
  affiliation_confirmed: true,
  website: null,
  turnstile_token: null,
};

const env = {
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "public-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  SUBMISSION_FINGERPRINT_SECRET: "test-fingerprint-secret",
} satisfies Env;

const request = () =>
  new Request("https://perkcommons.com/api/submissions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": "192.0.2.1",
    },
    body: JSON.stringify(submission),
  });

test("public submissions populate the required legacy website URL", async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async (_input, init) => {
    call += 1;
    if (call <= 2) return Response.json([]);
    if (call === 3) {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.website_url, submission.source_url);
      assert.equal(body.primary_category, "funding");
      assert.deepEqual(body.subcategories, ["grants"]);
      return Response.json([{ id: "00000000-0000-4000-8000-000000000001" }]);
    }
    return Response.json([{}]);
  };

  try {
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 201);
    assert.equal(call, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("public database failures are converted to a generic service error", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    if (call <= 2) return Response.json([]);
    return Response.json(
      {
        code: "23502",
        message: 'null value in column "website_url" violates constraint',
      },
      { status: 400 },
    );
  };
  console.error = () => undefined;

  try {
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: "service_unavailable",
        message: "The submission service is temporarily unavailable.",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});
