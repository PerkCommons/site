# PerkCommons Next implementation status

Legend: `[ ]` not started, `[~]` in progress, `[x]` implemented, `[t]` tested, `[d]` deferred, `[b]` blocked. An implementation marker is not a test claim.

## Safety and audit

- [t] Historical fork ownership and parent relationships verified through GitHub.
- [t] On 2026-10-06, official `PerkCommons/site` and `PerkCommons/data` were fast-forwarded to the verified fork heads without rewriting history.
- [t] Local canonical remotes now point to the official repositories; personal forks are retained only as historical references.
- [x] `FORK_SAFETY.md` now records the completed repository migration.
- [t] Baseline data tests (5) and site unit tests (29) executed before implementation.
- [x] Current flows, boundaries and risks documented.

## Data and schema

- [t] Canonical v2 model generates JSON Schema, TypeScript, form options, OpenAPI components and draft SQL constraints.
- [t] V1-to-v2 migration preserves identity, URLs, legacy availability/geography and explicit unresolved fields.
- [t] Canonical v1 schema identity uses `perkcommons.com`; a legacy `.org` alias remains available for compatibility.
- [t] V2 availability accepts date-only or date-time review values without inventing a timezone.
- [t] Mixed-schema dry run: 1,068/1,068 records schema-valid; 779 v1 records migrated in memory and 289 existing v2 records validated without replacement.
- [t] Unknown country and impossible date-order runtime checks.
- [t] Importers write isolated candidate envelopes and contain no hard-coded review date or published-directory path.
- [t] Scope, quality, duplicate and stale reports generated deterministically for 2026-07-23.
- [t] 289 explicit high-confidence non-opportunity decisions preserve records and history while excluding them from default discovery; 779 remain default-eligible.
- [t] Scope automation is pinned to a versioned decision manifest with expected match counts; heuristic candidates cannot change publication or discovery state.
- [t] Removed the importer-generated `limited` default from 1,011 records and all 18 importers. A complete 1,068-record availability ledger now assigns 304 current/open, 10 rolling, 27 closed, 3 upcoming, 2 limited, 1 temporarily unavailable, 1 waitlist and 720 unconfirmed outcomes.
- [t] Availability research fetched 1,050 distinct HTTPS sources, retained hashes/short evidence excerpts, applied 17 context corrections, and labels all 332 v2 research records `automated-source-research` plus `needs-human-review`; it never claims manual approval.
- [x] Coverage reports are descriptive rather than quota failures.
- [t] Network source audit checked 1,086 published URLs on 2026-09-29: 0 confirmed broken URLs. Server-side/transient failures are classified as ambiguous rather than falsely reported as broken; measured rates are fed into the generated data-quality report.
- [d] Optional semantic duplicate detection.

## Public site and discovery

- [t] Directory initial HTML limited to 24 cards; search index lazy-loaded on interaction.
- [t] Homepage, category pages, default directory results and Pagefind consistently exclude records with `defaultSearchEligible: false`; explicit resource-type selection permits opt-in access.
- [t] Weighted title/provider/alias/benefit/category/tag/eligibility/description search, phrase gating, synonyms and typo tolerance.
- [t] Category, resource type, status, region and archived filters; URL persistence; incremental load.
- [t] JSON, JSONL, CSV, schema, OpenAPI, provider, facet, category and audience assets generated with commit/version metadata.
- [t] Paginated `/api/v1/opportunities` facade over static assets.
- [x] Distinct status styles and canonical brand mark/wordmark copied from the branding fork.
- [x] Moderator access moved out of primary/mobile navigation; theme control moved into header.
- [x] Listing detail quick facts plus local bookmark, compare-list, copy-link and record-export actions.
- [t] V2 detail pages keep provider, program, application and evidence URL purposes distinct and expose deadline calendar export plus public-safe provenance.
- [d] Provider pages, comparison workflow and high-value editorial audience guides.
- [d] Structured deadlines, closing-soon and highest-benefit sorts require reviewed v2 data.

## Security, removal and reliability

- [t] Central CSP report-only, Referrer-Policy, Permissions-Policy, nosniff, HSTS and COOP headers.
- [t] One-sided production Turnstile configuration fails closed.
- [t] Separate submission/report rate-limit binding selection; login/tracking bindings reserved.
- [t] Public reports require a valid published/tombstoned listing ID and duplicate open reports are suppressed without leaking report state.
- [t] Listing-state requests are ID-scoped, deduplicated, ETagged and edge-cacheable.
- [t] Edge tombstones take precedence over cache/Supabase and return 410.
- [t] Removal preparation writes a tombstone before Git preparation when the binding exists.
- [t] Publication and removal cron reconciliation use `Promise.allSettled`.
- [x] Production automation targets `PerkCommons/*`; the legacy fork-only guard is opt-in.
- [t] Production release workflow accepts an exact data SHA, validates the site/data pair, stages a Vercel production deployment without domains, smoke-tests it, and promotes only the tested build.
- [t] Named `dev` Worker uses a distinct `workers.dev` target, test-only rate-limit namespaces, no route, no cron and no GitHub automation secrets.
- [t] Static-asset `_headers` policy matches Worker responses; local runtime probe confirmed all six headers on the homepage.
- [t] Isolated Worker deployed to `perkcommons-next-fork-dev.cod3eater.workers.dev`; hosted homepage, listing, catalogue API, sitemap, Supabase state and 404 smoke checks passed.
- [d] Reason-sensitive tombstone policy, KV reconciliation, static tombstone feed and production smoke verification.
- [d] Worker-signed session replacing the reusable Supabase access token cookie.
- [d] GitHub App installation-token integration.

## Submission and moderation

- [x] Existing accessible preview and validation retained; public-field local autosave and duplicate warning added.
- [d] Public tracking reference, correction/withdrawal status workflow.
- [t] Cursor-based queue summary endpoint minimizes fields and excludes contributor descriptions and identity.
- [t] Dedicated unconfirmed-listing queue reads public static data, supports search/category filters and incremental loading, and exposes no contributor data.
- [t] Existing-listing editor creates an audited pending update against the stable canonical ID; publication preserves that ID and original creation timestamp.
- [t] Unconfirmed queue UI is isolated in `src/scripts/moderation/unconfirmed.ts` instead of adding its state to the legacy monolith.
- [t] Hosted listing-update schema is present in Supabase project `fspdxfhijtlebdnftkof`; the promoted live schema was reconciled in place rather than replaying the historical baseline.
- [d] Dedicated detail endpoint and deliberate audited email reveal.
- [d] Modular state model, cursor pagination, saved views and operational dashboard.
- [t] Optimistic revision and distinct second-review enforcement are present in the promoted Supabase schema.
- [t] Approval now requires explicit resource type, availability, deadline semantics, URL purposes, geography, sponsorship and checked claims; publication emits schema v2 without editorial defaults.
- [t] Publication-semantics fields are present in the promoted Supabase schema and older approvals still require human re-review before v2 publication.
- [t] Deterministic greenfield Supabase baseline creates the missing root submission table and squashes all ten fork migrations into one empty-project transaction.
- [t] Greenfield baseline validated on disposable PostgreSQL 17: 13 tables, RLS/private grants, v2 approval, publication batching, report/removal batching and retention scheduling.
- [d] Selectable publication batches and field-level preview.

## Validation evidence

- [t] Release data gate on 2026-09-29: mixed-schema migration dry run validated 1,068/1,068 records; generated quality/source reports completed; 1,086 published URLs were audited with 0 confirmed broken URLs; missing v2 review timestamps remain null rather than synthetic dates.
- [t] Clean installs: `npm ci` completed in data and site without using credentials.
- [t] Site release CI on commit `8011fcf` completed tests, build, static-site audit and Chromium browser suite successfully; later provenance/data-pin changes are revalidated by the same PR workflow.
- [t] Site: `npm run build` — 1,095 static routes built; Pagefind indexed 779 default-eligible detail pages.
- [t] Browser: final full Chromium desktop/mobile suite — 54 passed, 4 intentionally skipped, 0 failed, including the unconfirmed queue/edit proposal workflow.
- [t] Wrangler 4.113.0 `dev` dry run read 3,064 static assets and exited without authentication or deployment.
- [t] Local Wrangler runtime: homepage/security headers, paginated catalogue API and sitemap returned 200; unknown API returned 404.
- [t] Branding JSON/SVG workflow checks passed locally.
- [b] Docs' exact offline Lychee check was not executable locally because the Lychee binary is not installed.
- [t] Data dependency audit reports zero known vulnerabilities after updating the transitive `fast-uri` lock.
- [~] Site dependency audit reports three high-severity development-tool findings through Wrangler/Miniflare `sharp`; npm offers only an unsafe Wrangler downgrade, so this remains registered.
- [ ] Manual Firefox/WebKit, forced-colors, screen-reader and 400% zoom review.

As of 2026-10-06, Supabase project `fspdxfhijtlebdnftkof` is the canonical backend, `PerkCommons/site` and `PerkCommons/data` are canonical source repositories, and `perkcommons.com` is live on Vercel. Future releases use the staged Vercel workflow documented in `docs/DEPLOYMENT_V2.md`.