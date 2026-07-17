import assert from "node:assert/strict";
import test from "node:test";
import {
  keyedFingerprint,
  maskEmail,
  normalizeIpAddress,
} from "../../worker/lib/fingerprints.ts";

test("IPv4 and IPv6 addresses are normalized without retaining raw variants", () => {
  assert.equal(normalizeIpAddress("192.168.001.1"), "192.168.1.1");
  assert.equal(
    normalizeIpAddress("2001:0DB8:0000:0000:0000:0000:0000:0001"),
    "2001:db8:0:0:0:0:0:1",
  );
  assert.equal(normalizeIpAddress("2001:db8::1"), "2001:db8:0:0:0:0:0:1");
  assert.equal(normalizeIpAddress("999.1.1.1"), null);
});

test("keyed fingerprints are deterministic, namespaced, and non-reversible output", async () => {
  const first = await keyedFingerprint("test-secret", "ip", "192.0.2.1");
  const second = await keyedFingerprint("test-secret", "ip", "192.0.2.1");
  const email = await keyedFingerprint("test-secret", "email", "192.0.2.1");
  assert.equal(first, second);
  assert.notEqual(first, email);
  assert.match(first ?? "", /^[a-f0-9]{64}$/);
  assert.equal(first?.includes("192.0.2.1"), false);
});

test("email hints conceal the local part", () =>
  assert.equal(maskEmail("jane@example.com"), "j***@example.com"));
