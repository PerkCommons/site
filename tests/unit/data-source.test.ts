import assert from "node:assert/strict";
import test from "node:test";
import {
  isExactCommitRef,
  resolveDataSource,
} from "../../scripts/data-source.mjs";

test("exact data refs distinguish immutable commits from branches", () => {
  assert.equal(
    isExactCommitRef("416803924a98bd3169169f790943079e648f1fab"),
    true,
  );
  assert.equal(isExactCommitRef("next/schema-v2"), false);
  assert.equal(isExactCommitRef("4168039"), false);
});

test("builds default to the canonical PerkCommons data repository", () => {
  const source = resolveDataSource({});
  assert.equal(source.repository, "https://github.com/PerkCommons/data.git");
  assert.equal(source.ref, "main");
});

test("builds reject an explicit non-canonical data repository", () => {
  assert.throws(
    () =>
      resolveDataSource({
        PERKCOMMONS_DATA_REPOSITORY:
          "https://github.com/CodWasTaken/data.git",
        PERKCOMMONS_DATA_REF: "main",
      }),
    /canonical PerkCommons\/data/i,
  );
});

test("builds allow an exact commit pin inside the canonical data repository", () => {
  const sha = "db80383717ded0e29af497d36894c52bde8a01fa";
  const source = resolveDataSource({
    PERKCOMMONS_DATA_REPOSITORY:
      "https://github.com/PerkCommons/data.git",
    PERKCOMMONS_DATA_REF: sha,
  });
  assert.equal(source.repository, "https://github.com/PerkCommons/data.git");
  assert.equal(source.ref, sha);
});

test("release builds require an explicit data commit pin", () => {
  assert.throws(
    () =>
      resolveDataSource({
        PERKCOMMONS_RELEASE_CANDIDATE: "1",
      }),
    /PERKCOMMONS_DATA_REF.*exact.*commit/i,
  );
});

test("release builds accept a full data commit pin", () => {
  const sha = "879706e1021ae7f48736a0f98051685c08ca8d8e";
  const source = resolveDataSource({
    PERKCOMMONS_RELEASE_CANDIDATE: "1",
    PERKCOMMONS_DATA_REF: sha,
  });
  assert.equal(source.ref, sha);
});
