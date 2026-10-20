import assert from "node:assert/strict";
import test from "node:test";
import { validateSubmission } from "../lib/validation";
import { actionAllowedForStatus } from "../lib/moderation-policy";
import { isCountryCode, parseCountryCodes } from "../../src/lib/geography";

const valid = {
  organization: "Test Organization",
  name: "Test opportunity",
  primary_category: "funding",
  subcategories: ["grants"],
  tags: [],
  source_url: "https://example.org/offer",
  description: "This is a suitable description of the test opportunity.",
  eligibility: "Open to the applicants described in the official source.",
  affiliation_confirmed: true,
};

test("Global availability is the default and never includes country filters", () => {
  assert.equal(validateSubmission(valid).location, "Global");
  assert.equal(validateSubmission({ ...valid, global: true, countries: [] }).location, "Global");
  assert.throws(
    () => validateSubmission({ ...valid, global: true, countries: ["US"] }),
    /Choose Global/,
  );
});

test("Limited submissions require valid unique ISO countries", () => {
  assert.equal(
    validateSubmission({ ...valid, global: false, countries: ["US", "CA"] }).location,
    "US, CA",
  );
  for (const codes of [[], ["US", "US"], ["ZZ"], ["us"], ["USA"]]) {
    assert.throws(() => validateSubmission({ ...valid, global: false, countries: codes }), /Choose Global/);
  }
});

test("Legacy country codes can be recovered without guessing free-text locations", () => {
  assert.deepEqual(parseCountryCodes("US, CA"), ["US", "CA"]);
  assert.deepEqual(parseCountryCodes("San Francisco"), []);
  assert.equal(isCountryCode("US"), true);
  assert.equal(isCountryCode("ZZ"), false);
});

test("A claimed review remains actionable", () => {
  assert.equal(actionAllowedForStatus("reviewing", "approve"), true);
  assert.equal(actionAllowedForStatus("reviewing", "decline"), true);
  assert.equal(actionAllowedForStatus("reviewing", "flag"), true);
});
