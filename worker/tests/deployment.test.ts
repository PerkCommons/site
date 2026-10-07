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

const dataSha = "0123456789abcdef0123456789abcdef01234567";

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

test("site deployment requires the GitHub workflow token", () => {
  assert.equal(
    siteDeploymentConfigured({
      GITHUB_SITE_DEPLOY_TOKEN: "token",
    } as Env),
    true,
  );
  assert.equal(siteDeploymentConfigured({} as Env), false);
});

test("site deployment rejects non-immutable data refs", async () => {
  await assert.rejects(
    requestSiteDeployment(
      {
        GITHUB_SITE_DEPLOY_TOKEN: "token",
        GITHUB_SITE_REPOSITORY: "PerkCommons/site",
        FORK_ONLY_MODE: "false",
      } as Env,
      "main",
    ),
    /exact data commit/i,
  );
});

test("GitHub deployment dispatch pins the exact data commit", async () => {
  const originalFetch = globalThis.fetch;
  let call:
    | { url: string; method: string; body: Record<string, unknown> }
    | undefined;
  globalThis.fetch = async (input, init) => {
    call = {
      url: String(input),
      method: init?.method ?? "GET",
      body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
    };
    return new Response(null, { status: 204 });
  };

  try {
    await requestSiteDeployment(
      {
        GITHUB_SITE_DEPLOY_TOKEN: "token",
        GITHUB_SITE_REPOSITORY: "PerkCommons/site",
        FORK_ONLY_MODE: "false",
      } as Env,
      dataSha,
    );
    assert.deepEqual(call, {
      url: "https://api.github.com/repos/PerkCommons/site/actions/workflows/deploy.yml/dispatches",
      method: "POST",
      body: {
        ref: "main",
        inputs: { data_sha: dataSha },
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub deployment obeys the optional fork-only guard", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null, { status: 204 });
  };

  try {
    await assert.rejects(
      requestSiteDeployment(
        {
          GITHUB_SITE_DEPLOY_TOKEN: "token",
          GITHUB_SITE_REPOSITORY: "PerkCommons/site",
          FORK_ONLY_MODE: "true",
        } as Env,
        dataSha,
      ),
      /fork-only/i,
    );
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
