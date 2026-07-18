import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeCountryCode,
  normalizeEmail,
  safeHttpsUrl,
  validateSubmission,
} from "../../worker/lib/validation.ts";
import { CATEGORY_IDS } from "../../src/lib/taxonomy.ts";

const validSubmission = {
  organization: "Example Foundation",
  name: "Open Infrastructure Grant",
  primary_category: "funding",
  subcategories: ["grants"],
  tags: ["open-source"],
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
  assert.equal(result.primary_category, "funding");
  assert.deepEqual(result.subcategories, ["grants"]);
});

test("submission validation accepts every canonical category", () => {
  for (const category of CATEGORY_IDS) {
    assert.equal(
      validateSubmission({
        ...validSubmission,
        primary_category: category,
        subcategories: [],
      }).primary_category,
      category,
    );
  }
});

test("submission validation rejects unsafe URLs and unknown categories", () => {
  assert.throws(() =>
    validateSubmission({
      ...validSubmission,
      source_url: "javascript:alert(1)",
    }),
  );
  assert.throws(() =>
    validateSubmission({ ...validSubmission, primary_category: "coupons" }),
  );
  assert.throws(() =>
    validateSubmission({
      ...validSubmission,
      primary_category: "student-benefits",
      subcategories: ["cloud-credits"],
    }),
  );
  assert.throws(() =>
    validateSubmission({
      ...validSubmission,
      subcategories: ["grants", "grants"],
    }),
  );
  assert.throws(() => safeHttpsUrl("http://example.org", "Source"));
});

test("email and country normalization handle malformed values", () => {
  assert.equal(normalizeEmail(" Person@Example.org "), "person@example.org");
  assert.throws(() => normalizeEmail("not-an-email"));
  assert.equal(normalizeCountryCode("pl"), "PL");
  assert.equal(normalizeCountryCode("unknown"), null);
});
