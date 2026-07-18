import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPublicationData,
  buildReviewBrief,
  countryFlag,
  countryName,
  type ModerationSubmission,
} from "../../src/lib/moderation.ts";

const submission: ModerationSubmission = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Open Grant",
  organization: "Commons Org",
  categories: ["funding"],
  primary_category: "funding",
  subcategories: ["research-funding"],
  tags: ["open-source"],
  description: "A well documented grant.",
  eligibility: "Open maintainers may apply.",
  benefits: "$10,000",
  location: "Global",
  deadline: "2026-12-01",
  source_url: "https://example.org/grant",
  organization_website_url: "https://example.org",
  submitter_name: "Jane",
  submitter_email: "jane@example.org",
  submitter_notes: "I work for the provider.",
  status: "pending",
  risk_score: 0,
  flag_count: 0,
  submission_country_code: "PL",
  created_at: "2026-07-17T12:00:00Z",
  reviewed_at: null,
  published_at: null,
  decision_reason: null,
};

test("country names and flags have neutral unknown fallbacks", () => {
  assert.equal(countryName("PL"), "Poland");
  assert.equal(countryFlag("PL"), "🇵🇱");
  assert.equal(countryName(null), "Unknown country");
  assert.equal(countryFlag("bad"), null);
});

test("review briefs include evidence and redacted briefs omit private identity", () => {
  const full = buildReviewBrief(submission);
  const redacted = buildReviewBrief(submission, {}, true);
  assert.match(full, /jane@example\.org/);
  assert.match(full, /Submission country: Poland \(PL\)/);
  assert.match(full, /Primary category: Funding \(funding\)/);
  assert.match(full, /Subcategories: Research funding/);
  assert.doesNotMatch(redacted, /jane@example\.org|I work for the provider/);
  assert.match(redacted, /Private submitter details redacted/);
});

test("publication copy contains only public listing fields", () => {
  const output = buildPublicationData(submission);
  assert.match(output, /provider: "Commons Org"/);
  assert.match(output, /subcategories: \["research-funding"\]/);
  assert.doesNotMatch(output, /jane@example\.org|risk_score|submitter/);
});
