import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareListingRemovalForReport,
  reconcileListingRemovals,
  type ListingRemovalBatch,
} from "../lib/removal";
import type { Env } from "../lib/types";

const reportId = "11111111-1111-4111-8111-111111111111";
const batchId = "22222222-2222-4222-8222-222222222222";

const env = {
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "public-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  SUBMISSION_FINGERPRINT_SECRET: "fingerprint-secret",
  GITHUB_DATA_PUBLICATION_TOKEN: "data-publication-token",
  GITHUB_SITE_DEPLOY_TOKEN: "site-deploy-token",
} satisfies Env;

const removalBatch = (
  values: Partial<ListingRemovalBatch> = {},
): ListingRemovalBatch => ({
  id: batchId,
  report_id: reportId,
  listing_id: "example-reported-opportunity",
  status: "preparing",
  created_by: "33333333-3333-4333-8333-333333333333",
  github_branch: null,
  github_pr_number: null,
  github_pr_url: null,
  github_head_sha: null,
  github_merge_sha: null,
  last_error_code: null,
  deployment_requested_at: null,
  created_at: "2026-07-19T12:00:00Z",
  removed_at: null,
  ...values,
});

test("an upheld report creates a PR deleting only its stable listing file", async () => {
  const originalFetch = globalThis.fetch;
  let treeBody: Record<string, unknown> | undefined;
  const patches: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("listing_removal_batches?report_id=eq."))
      return Response.json([removalBatch()]);
    if (url.includes("/pulls?state=open")) return Response.json([]);
    if (url.endsWith("/git/ref/heads/main"))
      return Response.json({ object: { sha: "base-sha" } });
    if (url.includes("/contents/opportunities/example-reported-opportunity.json"))
      return Response.json({ sha: "file-sha" });
    if (url.endsWith("/git/commits/base-sha"))
      return Response.json({ tree: { sha: "base-tree" } });
    if (url.endsWith("/git/trees") && method === "POST") {
      treeBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ sha: "removal-tree" }, { status: 201 });
    }
    if (url.endsWith("/git/commits") && method === "POST")
      return Response.json({ sha: "removal-commit" }, { status: 201 });
    if (url.includes("/git/refs/heads/removal-") && method === "GET")
      return Response.json({ message: "Not Found" }, { status: 404 });
    if (url.endsWith("/git/refs") && method === "POST")
      return Response.json({}, { status: 201 });
    if (url.endsWith("/pulls") && method === "POST")
      return Response.json(
        {
          number: 14,
          html_url: "https://github.com/PerkCommons/data/pull/14",
          state: "open",
          merged: false,
          merged_at: null,
          merge_commit_sha: null,
          head: { sha: "removal-commit" },
        },
        { status: 201 },
      );
    if (url.includes("listing_removal_batches?id=eq.") && method === "PATCH") {
      patches.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  try {
    const batch = await prepareListingRemovalForReport(env, reportId);
    assert.equal(batch?.github_pr_number, 14);
    assert.deepEqual(treeBody?.tree, [
      {
        path: "opportunities/example-reported-opportunity.json",
        mode: "100644",
        type: "blob",
        sha: null,
      },
    ]);
    assert.ok(patches.some((patch) => patch.status === "validating"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an already absent listing completes idempotently and requests a rebuild", async () => {
  const originalFetch = globalThis.fetch;
  let finalized = false;
  let deployed = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("listing_removal_batches?report_id=eq."))
      return Response.json([removalBatch()]);
    if (url.includes("/pulls?state=open")) return Response.json([]);
    if (url.endsWith("/git/ref/heads/main"))
      return Response.json({ object: { sha: "base-sha" } });
    if (url.includes("/contents/opportunities/example-reported-opportunity.json"))
      return Response.json({ message: "Not Found" }, { status: 404 });
    if (url.endsWith("/rpc/finalize_listing_removal_batch")) {
      finalized = true;
      return Response.json("example-reported-opportunity");
    }
    if (url.endsWith("/actions/workflows/deploy.yml/dispatches")) {
      deployed = true;
      return new Response(null, { status: 204 });
    }
    if (url.includes("listing_removal_batches?id=eq.") && method === "PATCH")
      return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  try {
    const batch = await prepareListingRemovalForReport(env, reportId);
    assert.equal(batch?.status, "removed");
    assert.equal(finalized, true);
    assert.equal(deployed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("removal reconciliation waits for validation before merge and deployment", async () => {
  const originalFetch = globalThis.fetch;
  let merged = false;
  let finalized = false;
  let deployed = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("status=in.(preparing,validating,merging)"))
      return Response.json([
        removalBatch({
          status: "validating",
          github_pr_number: 14,
          github_head_sha: "removal-commit",
        }),
      ]);
    if (url.endsWith("/pulls/14"))
      return Response.json({
        number: 14,
        html_url: "https://github.com/PerkCommons/data/pull/14",
        state: "open",
        merged: false,
        merged_at: null,
        merge_commit_sha: null,
        head: { sha: "removal-commit" },
      });
    if (url.includes("/commits/removal-commit/check-runs"))
      return Response.json({
        check_runs: [
          { name: "validate", status: "completed", conclusion: "success" },
        ],
      });
    if (url.endsWith("/pulls/14/merge") && method === "PUT") {
      merged = true;
      return Response.json({ merged: true, sha: "merge-sha" });
    }
    if (url.endsWith("/rpc/finalize_listing_removal_batch")) {
      finalized = true;
      return Response.json("example-reported-opportunity");
    }
    if (url.endsWith("/actions/workflows/deploy.yml/dispatches")) {
      deployed = true;
      return new Response(null, { status: 204 });
    }
    if (url.includes("listing_removal_batches?id=eq.") && method === "PATCH")
      return new Response(null, { status: 204 });
    if (url.includes("status=eq.removed&deployment_requested_at=is.null"))
      return Response.json([]);
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  try {
    await reconcileListingRemovals(env);
    assert.equal(merged, true);
    assert.equal(finalized, true);
    assert.equal(deployed, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
