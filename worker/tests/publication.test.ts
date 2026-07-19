import assert from "node:assert/strict";
import test from "node:test";
import worker from "../index";
import {
  publicationListingId,
  reconcilePublicationBatches,
  startPublicationBatch,
  toPublishedOpportunity,
  type PublicationPayload,
} from "../lib/publication";
import type { Env, Moderator } from "../lib/types";

const payload: PublicationPayload = {
  submission_id: "11111111-1111-4111-8111-111111111111",
  title: "Open Infrastructure Grant",
  organization: "Example Foundation",
  primary_category: "funding",
  subcategories: ["research-funding"],
  tags: ["open-source"],
  description: "Funding for maintainers of open public infrastructure projects.",
  eligibility: "Open-source maintainers worldwide may apply.",
  benefits: "$10,000 in unrestricted project funding.",
  location: "Global",
  deadline: "2026-12-01",
  source_url: "https://example.org/grant",
  organization_website_url: "https://example.org",
};

const env = {
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "public-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  SUBMISSION_FINGERPRINT_SECRET: "fingerprint-secret",
  GITHUB_DATA_PUBLICATION_TOKEN: "data-publication-token",
  GITHUB_SITE_DEPLOY_TOKEN: "site-deploy-token",
} satisfies Env;

const administrator: Moderator = {
  userId: "22222222-2222-4222-8222-222222222222",
  email: "admin@perkcommons.com",
  role: "admin",
};

test("publication data uses stable IDs and the public data schema", () => {
  const listingId = publicationListingId(payload);
  assert.equal(listingId, "example-foundation-open-infrastructure-grant-11111111");
  assert.ok(listingId.length <= 80);
  assert.deepEqual(toPublishedOpportunity(payload, "2026-07-19"), {
    id: listingId,
    provider: "Example Foundation",
    title: "Open Infrastructure Grant",
    category: "funding",
    subcategories: ["research-funding"],
    tags: ["open-source"],
    description: payload.description,
    eligibility: payload.eligibility,
    value: payload.benefits,
    sourceUrl: payload.source_url,
    officialUrl: payload.organization_website_url,
    status: "active",
    submissionType: "community",
    sponsor: false,
    reviewDate: "2026-07-19",
    regions: ["Global"],
    notes: "Submitted application deadline: 2026-12-01.",
  });
});

test("reviewers cannot start publication batches through the Worker API", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/auth/v1/user"))
      return Response.json({
        id: "44444444-4444-4444-8444-444444444444",
        email: "reviewer@perkcommons.com",
      });
    if (url.includes("moderator_profiles")) return Response.json([{ role: "reviewer" }]);
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const response = await worker.fetch(
      new Request("https://perkcommons.com/api/moderation/publications", {
        method: "POST",
        headers: {
          cookie: "pc_moderator_session=test-session",
          origin: "https://perkcommons.com",
        },
      }),
      env,
    );
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: {
        code: "forbidden",
        message: "Administrator access is required.",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("starting a publication batch creates one data PR with every claimed item", async () => {
  const originalFetch = globalThis.fetch;
  let treeBody: Record<string, unknown> | undefined;
  const patches: Array<Record<string, unknown>> = [];
  const storedBatch: Record<string, unknown> = {
    id: "33333333-3333-4333-8333-333333333333",
    status: "preparing",
    item_count: 1,
    github_branch: null,
    github_pr_number: null,
    github_pr_url: null,
    github_head_sha: null,
    github_merge_sha: null,
    last_error_code: null,
    deployment_requested_at: null,
    created_at: "2026-07-19T12:00:00Z",
    published_at: null,
  };
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.endsWith("/rpc/begin_publication_batch"))
      return Response.json("33333333-3333-4333-8333-333333333333");
    if (url.includes("publication_batches?id=eq.") && method === "GET")
      return Response.json([storedBatch]);
    if (url.endsWith("/rpc/publication_batch_payload"))
      return Response.json([payload]);
    if (url.includes("publication_batch_items"))
      return new Response(null, { status: 204 });
    if (url.includes("/pulls?state=open")) return Response.json([]);
    if (url.endsWith("/git/ref/heads/main"))
      return Response.json({ object: { sha: "base-sha" } });
    if (url.endsWith("/git/commits/base-sha"))
      return Response.json({ tree: { sha: "base-tree" } });
    if (url.endsWith("/git/trees") && method === "POST") {
      treeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ sha: "new-tree" }, { status: 201 });
    }
    if (url.endsWith("/git/commits") && method === "POST")
      return Response.json({ sha: "new-commit" }, { status: 201 });
    if (url.includes("/git/refs/heads/publication-") && method === "GET")
      return Response.json({ message: "Not Found" }, { status: 404 });
    if (url.endsWith("/git/refs") && method === "POST")
      return Response.json({}, { status: 201 });
    if (url.endsWith("/pulls") && method === "POST")
      return Response.json(
        {
          number: 12,
          html_url: "https://github.com/PerkCommons/data/pull/12",
          state: "open",
          merged: false,
          merged_at: null,
          merge_commit_sha: null,
          head: { sha: "new-commit" },
        },
        { status: 201 },
      );
    if (url.includes("publication_batches?id=eq.") && method === "PATCH") {
      const patch = JSON.parse(String(init?.body)) as Record<string, unknown>;
      patches.push(patch);
      Object.assign(storedBatch, patch);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  try {
    const batch = await startPublicationBatch(env, administrator);
    assert.equal(batch?.github_pr_number, 12);
    const entries = treeBody?.tree as Array<{ path: string; content: string }>;
    assert.equal(entries.length, 1);
    assert.equal(
      entries[0]?.path,
      "opportunities/example-foundation-open-infrastructure-grant-11111111.json",
    );
    assert.equal(JSON.parse(entries[0]?.content ?? "{}").title, payload.title);
    assert.ok(patches.some((patch) => patch.status === "validating"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an active publication batch is returned without rewriting its data branch", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls += 1;
    const url = String(input);
    if (url.endsWith("/rpc/begin_publication_batch"))
      return Response.json("33333333-3333-4333-8333-333333333333");
    if (url.includes("publication_batches?id=eq."))
      return Response.json([
        {
          id: "33333333-3333-4333-8333-333333333333",
          status: "validating",
          item_count: 2,
          github_branch: "publication-33333333-3333-4333-8333-333333333333",
          github_pr_number: 12,
          github_pr_url: "https://github.com/PerkCommons/data/pull/12",
          github_head_sha: "new-commit",
          github_merge_sha: null,
          last_error_code: null,
          deployment_requested_at: null,
          created_at: "2026-07-19T12:00:00Z",
          published_at: null,
        },
      ]);
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const batch = await startPublicationBatch(env, administrator);
    assert.equal(batch?.status, "validating");
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reconciliation merges only after validation and then requests deployment", async () => {
  const originalFetch = globalThis.fetch;
  const rpcCalls: string[] = [];
  let mergeCalled = false;
  let deploymentCalled = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("status=in.(validating,merging)"))
      return Response.json([
        {
          id: "33333333-3333-4333-8333-333333333333",
          status: "validating",
          item_count: 1,
          github_branch: "publication-33333333-3333-4333-8333-333333333333",
          github_pr_number: 12,
          github_pr_url: "https://github.com/PerkCommons/data/pull/12",
          github_head_sha: "new-commit",
          github_merge_sha: null,
          last_error_code: null,
          deployment_requested_at: null,
          created_at: "2026-07-19T12:00:00Z",
          published_at: null,
        },
      ]);
    if (url.endsWith("/pulls/12") && method === "GET")
      return Response.json({
        number: 12,
        html_url: "https://github.com/PerkCommons/data/pull/12",
        state: "open",
        merged: false,
        merged_at: null,
        merge_commit_sha: null,
        head: { sha: "new-commit" },
      });
    if (url.includes("/commits/new-commit/check-runs"))
      return Response.json({
        check_runs: [{ name: "validate", status: "completed", conclusion: "success" }],
      });
    if (url.endsWith("/pulls/12/merge") && method === "PUT") {
      mergeCalled = true;
      return Response.json({ merged: true, sha: "merge-sha" });
    }
    if (url.endsWith("/rpc/finalize_publication_batch")) {
      rpcCalls.push(String(init?.body));
      return Response.json(1);
    }
    if (url.endsWith("/actions/workflows/deploy.yml/dispatches")) {
      deploymentCalled = true;
      return new Response(null, { status: 204 });
    }
    if (url.includes("publication_batches?id=eq.") && method === "PATCH")
      return new Response(null, { status: 204 });
    if (url.includes("status=eq.published&deployment_requested_at=is.null"))
      return Response.json([]);
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  try {
    await reconcilePublicationBatches(env);
    assert.equal(mergeCalled, true);
    assert.equal(deploymentCalled, true);
    assert.equal(rpcCalls.length, 1);
    assert.match(rpcCalls[0] ?? "", /merge-sha/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
