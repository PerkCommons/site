# Opportunity schema version 2

The canonical source is `PerkCommons/data/schema/opportunity-v2.model.json`. Do not hand-edit generated copies in the site. Run `npm run generate` in the data repository and `npm run generate:check` in review.

Generated artifacts:

- `schema/opportunity-v2.schema.json` — JSON Schema 2020-12
- `generated/opportunity-v2.ts` — TypeScript constants and types
- `generated/form-options.json` — form/moderation enumerations
- `generated/openapi-components.json` — OpenAPI schema component
- `generated/opportunity-v2.constraints.sql` — review-required draft constraints

The schema separates identity, URL purposes/evidence claims, resource classification, normalized geography, availability, structured costs/benefits, eligibility, public-safe review provenance, change history and sponsorship. `canonicalUrl`, provider/program/application URLs, geography assertions and sponsorship may be null when editorial evidence is unresolved; null is preferable to an invented default.

V2 status values are `open`, `rolling`, `upcoming`, `limited`, `waitlist`, `temporarily-unavailable`, `closed`, `expired`, `unconfirmed`, `disputed`, and `archived`. Resource types distinguish opportunity, resource, benefit, program, event, funding, fellowship, competition, community, learning resource, public dataset and general free product.

Review provenance never requires a public moderator identity. `reviewerReference` may be a public role or pseudonym. A private user ID must not be exported. Migrated v1 records use `legacy-record-migration`, no reviewer reference, null confidence and `needs-human-review`.

The canonical schema identifier is `https://perkcommons.com/schema/opportunity-v2.json`; the unresolved `.org` identifier from v1 is not reused.

The v1 schema is now canonical at `https://perkcommons.com/schema/opportunity.json`.
`/schema/opportunity-v1-legacy.json` publishes a compatibility alias carrying the
old `.org` identifier and referring consumers to the `.com` schema. Existing
records remain v1-compatible; the alias does not rewrite their history.

## Validation beyond shape

Runtime checks add ISO country membership, opening/closing order, open listings with passed deadlines, filename/ID agreement, unsupported versions, normalized v2 provider/title duplicates and canonical URL duplicates unless explicitly related. Report-only checks identify generic text, probable bundles and duplicated evidence for human review.

## Compatibility

V1 remains supported. The public dataset must not be bulk-replaced by migration output. A mixed reader identifies v2 by `schemaVersion: "2.0"`; absence means v1 during transition. Compatibility metadata advertises `1+2.0` until all consumers and publication tools pass cross-repository tests.
