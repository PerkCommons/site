import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCountryCode,
  normalizeEmail,
  safeHttpsUrl,
  validateSubmission,
} from "../../worker/lib/validation.ts";

const validSubmission = {
  organization: "Example Foundation",
  name: "Open Infrastructure Grant",
  categories: ["grants"],
  source_url: "https://example.org/grant",
  description: "Funding for maintainers of open public infrastructure.",
  eligibility: "Maintainers worldwide may apply.",
  affiliation_confirmed: true,
};

test("submission validation normalizes safe input", () => {
  const result = validateSubmission({
    ...validSubmission,
    submitter_email: "  USER@Example.COM ",
  });
  assert.equal(result.submitter_email, "user@example.com");
  assert.equal(result.source_url, "https://example.org/grant");
});

test("submission validation rejects unsafe URLs and unknown categories", () => {
  assert.throws(() =>
    validateSubmission({
      ...validSubmission,
      source_url: "javascript:alert(1)",
    }),
  );
  assert.throws(() =>
    validateSubmission({ ...validSubmission, categories: ["coupons"] }),
  );
  assert.throws(() => safeHttpsUrl("http://example.org", "Source"));
});

test("email and country normalization handle malformed values", () => {
  assert.equal(normalizeEmail(" Person@Example.org "), "person@example.org");
  assert.throws(() => normalizeEmail("not-an-email"));
  assert.equal(normalizeCountryCode("pl"), "PL");
  assert.equal(normalizeCountryCode("unknown"), null);
});
