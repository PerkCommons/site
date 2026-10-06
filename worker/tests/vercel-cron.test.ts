import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeCron,
  handleCronRequest,
  runReconciliation,
} from "../../api/cron/reconcile";
import type { Env } from "../lib/types";

const env = (): Env => ({
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "public",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SUBMISSION_FINGERPRINT_SECRET: "fingerprint-secret",
  CRON_SECRET: "secret",
  GITHUB_DATA_REPOSITORY: "PerkCommons/data",
  GITHUB_DATA_BRANCH: "main",
  GITHUB_HEAD_OWNER: "PerkCommons",
  FORK_ONLY_MODE: "false",
});

test("cron rejects missing credentials", () => {
  assert.equal(authorizeCron(undefined, "secret"), false);
});

test("cron requires exact bearer secret", () => {
  assert.equal(authorizeCron("Bearer secret", "secret"), true);
  assert.equal(authorizeCron("Bearer wrong", "secret"), false);
});

test("cron endpoint rejects unauthenticated calls before reconciliation", async () => {
  const response = await handleCronRequest(
    new Request("https://next.example/api/cron/reconcile"),
    env(),
  );
  assert.equal(response.status, 401);
});

test("reconciliation runs publication before removal", async () => {
  const order: string[] = [];
  await runReconciliation(env(), {
    publications: async () => {
      order.push("publication");
    },
    removals: async () => {
      order.push("removal");
    },
  });
  assert.deepEqual(order, ["publication", "removal"]);
});