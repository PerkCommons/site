import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve("scripts/verify-source-audit.mjs");
const knownBroken = {
  file: "google-open-source-peer-bonus.json",
  field: "sourceUrl",
  url: "https://opensource.google/programs-and-services/peer-bonus/winner",
  status: "broken",
  httpStatus: 404,
};

function verify(records: Array<Record<string, unknown>>, exitCode: number) {
  const root = mkdtempSync(join(tmpdir(), "perkcommons-audit-policy-"));
  try {
    const file = join(root, "audit.json");
    writeFileSync(file, JSON.stringify({ reportVersion: 2, counts: { broken: records.length }, records }));
    return spawnSync(process.execPath, [script, String(exitCode), file], { encoding: "utf8" });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("accepts successful canonical audits without URL exceptions", () => {
  assert.equal(verify([], 0).status, 0);
});

test("tracks a single explicitly recorded Google source 404 without excusing others", () => {
  const result = verify([knownBroken], 1);
  assert.equal(result.status, 0);
  assert.match(result.stderr, /PerkCommons\/data#12/);
});

test("fails CI for any different broken URL", () => {
  assert.notEqual(verify([knownBroken, { ...knownBroken, url: "https://example.com/dead" }], 1).status, 0);
  assert.notEqual(verify([{ ...knownBroken, file: "another-program.json" }], 1).status, 0);
  assert.notEqual(verify([{ ...knownBroken, httpStatus: 410 }], 1).status, 0);
});

test("fails an unexplained audit failure or inconsistent report", () => {
  assert.notEqual(verify([], 1).status, 0);
  const result = verify([knownBroken, knownBroken, knownBroken], 1);
  assert.notEqual(result.status, 0);
});
