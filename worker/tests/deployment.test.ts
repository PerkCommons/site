import assert from "node:assert/strict";
import test from "node:test";
import {
  requestSiteDeployment,
  siteDeploymentConfigured,
} from "../lib/deployment";
import {
  assertForkOnlyRepository,
  githubTargetConfig,
} from "../lib/github-targets";
import type { Env } from "../lib/types";

test("fork-only mode refuses original organization repositories", () => {
  assert.throws(
    () => assertForkOnlyRepository("PerkCommons/data", "true"),
    /fork-only/i,
  );
  assert.doesNotThrow(() =>
    assertForkOnlyRepository("CodWasTaken/data", "true"),
  );
});

test("default target config resolves canonical PerkCommons data", () => {
  const config = githubTargetConfig({
    FORK_ONLY_MODE: "false",
  } as Env);
  assert.deepEqual(config, {
    dataRepository: "PerkCommons/data",
    dataBranch: "main",
    headOwner: "PerkCommons",
  });
});

test("a Vercel deploy hook configures site deployment", () => {
  assert.equal(
    siteDeploymentConfigured({
      VERCEL_DEPLOY_HOOK_URL:
        "https://api.vercel.com/v1/integrations/deploy/test-hook",
    } as Env),
    true,
  );
});

test("Vercel deploy hook is called with POST", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return Response.json({ job: { id: "job_test" } });
  };

  try {
    await requestSiteDeployment({
      VERCEL_DEPLOY_HOOK_URL:
        "https://api.vercel.com/v1/integrations/deploy/test-hook",
    } as Env);
    assert.deepEqual(calls, [
      {
        url: "https://api.vercel.com/v1/integrations/deploy/test-hook",
        method: "POST",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("legacy GitHub deployment also obeys fork-only guard", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null, { status: 204 });
  };

  try {
    await assert.rejects(
      requestSiteDeployment({
        GITHUB_SITE_DEPLOY_TOKEN: "token",
        GITHUB_SITE_REPOSITORY: "PerkCommons/site",
        FORK_ONLY_MODE: "true",
      } as Env),
      /fork-only/i,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
