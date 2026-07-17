import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuditAction,
  canUndoAction,
  isBanActive,
  roleAllows,
  strongestBanMode,
} from "../../worker/lib/moderation-policy.ts";

test("ban matching ignores inactive and expired records", () => {
  const now = new Date("2026-07-17T12:00:00Z");
  assert.equal(
    isBanActive(
      { active: true, expires_at: "2026-07-17T13:00:00Z", mode: "block" },
      now,
    ),
    true,
  );
  assert.equal(
    isBanActive(
      { active: true, expires_at: "2026-07-17T11:00:00Z", mode: "block" },
      now,
    ),
    false,
  );
  assert.equal(
    strongestBanMode(
      [
        { active: true, expires_at: null, mode: "warn" },
        { active: true, expires_at: null, mode: "flag" },
      ],
      now,
    ),
    "flag",
  );
});

test("reviewers cannot use administrator controls", () => {
  assert.equal(roleAllows("reviewer", "review"), true);
  assert.equal(roleAllows("reviewer", "ban"), false);
  assert.equal(roleAllows("admin", "manage_moderators"), true);
});

test("audit actions preserve status transitions and undo has a bounded window", () => {
  assert.deepEqual(buildAuditAction("pending", "approve", "Verified"), {
    action: "approve",
    previous_status: "pending",
    new_status: "approved",
    reason: "Verified",
  });
  const now = new Date("2026-07-17T12:10:00Z");
  assert.equal(canUndoAction("2026-07-17T12:01:00Z", now), true);
  assert.equal(canUndoAction("2026-07-17T11:59:00Z", now), false);
});
