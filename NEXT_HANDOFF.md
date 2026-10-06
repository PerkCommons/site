# PerkCommons Next promotion handoff

> **Superseded operational state — 2026-10-06:** `PerkCommons/site` and `PerkCommons/data` are now the canonical repositories, `perkcommons.com` is live on Vercel, and the fork-only deployment notes below are retained as historical migration evidence. Current release behavior is documented in `docs/DEPLOYMENT_V2.md`.

Originally prepared 2026-07-24 and reconciled for the authorized main-promotion release candidate on 2026-09-29. The release candidate remains non-canonical on the public web until hosted Vercel verification and the later `perkcommons.com` cutover are complete.

## Completed work

- Established fork-only remotes, disabled every official upstream push URL, and recorded the safety boundary in every repository.
- Audited the current public-data, submission, moderation, publication, removal, deployment, search, Supabase, Cloudflare, automation, and privacy boundaries.
- Added one canonical opportunity-v2 model with generated JSON Schema, TypeScript, runtime validation, form options, OpenAPI components, and draft SQL constraints.
- Added a non-destructive v1-to-v2 migration. Its mixed-schema dry run validated all 1,068 records: 779 v1 records migrated in memory and 289 existing v2 records validated without being migrated again, preserving 10,448 ambiguous values as explicit unresolved markers.
- Replaced catalogue quotas with descriptive coverage plus deterministic scope, quality, duplicate-candidate, stale-record, and migration reports. A versioned, fixed-count decision manifest excludes 289 clear non-opportunities from default discovery while preserving every record and its Git history; heuristics do not delete, merge, archive, publish, or change discovery state.
- Isolated all importers behind candidate envelopes; importers no longer write into the canonical published directory or hard-code review dates.
- Replaced the 1,068-card directory DOM with a static-first 24-card first page, lazy weighted search, URL-persistent filters, sorting, and incremental loading.
- Applied the scope decision consistently to homepage/category listings, default directory search, and Pagefind. The 779 default opportunities remain discoverable; typed resources can be reached only after an explicit resource-type opt-in.
- Corrected 1,011 importer-generated `limited` availability values to `unconfirmed` without claiming that sources are currently open. All 18 importers now emit unreviewed candidates as `unconfirmed`, and regression checks prevent that blanket default from returning.
- Checked all 1,068 records against 1,050 distinct provider URLs and applied a conservative availability ledger: 304 current/open, 10 rolling, 27 closed, 3 upcoming, 2 limited, 1 temporarily unavailable, 1 waitlist and 720 unconfirmed. Seventeen date/context corrections are versioned separately; automated checks remain `needs-human-review` and never claim manual approval.
- Generated static JSON/JSONL/CSV exports, search/facet/provider/category/audience assets, schema, OpenAPI, tombstone/change-feed placeholders, compatibility metadata, and a paginated public API facade.
- Improved branded cards, status presentation, detail-page URL semantics, convenience actions, and submission autosave/duplicate warning behavior.
- Corrected the canonical v1 schema domain with a compatibility alias and taught the site to consume both v1 and v2 records without flattening v2 status, URLs, deadlines, geography or provenance.
- Reworked approval/publication so moderators make explicit v2 editorial choices and publication refuses incomplete legacy approvals rather than forcing `active`, `Global`, `community` or non-sponsored defaults.
- Scoped and cached public listing-state reads, validated report targets against a static manifest/tombstones, and suppressed duplicate open reports without exposing whether a report already exists.
- Added centralized report-only CSP and security headers, separate intake rate-limit bindings, edge-first tombstone suppression, fail-closed configured tombstone access, and independent publication/removal cron settlement.
- Added a minimized moderation queue-summary endpoint and an unapplied SQL migration contract for assignment, revision, conflict-of-interest, and distinct second-review enforcement.
- Added a public-data-only unconfirmed-listing queue with exact counts,
  category/search filters, oldest-review-first ordering and incremental
  loading. Moderators can open the shared v2 editor and create an audited
  pending update proposal for the same stable listing ID; nothing is
  auto-approved or written directly to Git.
- Added the fork-only `202607240001_listing_update_workflow.sql` incremental
  migration and regenerated the empty-project baseline. The migration prevents
  overlapping active updates and carries canonical identity through validated
  publication.
- Added a generated, empty-project Supabase baseline containing the complete private fork schema, final RPCs, RLS, grants, triggers and retention schedule.
- Replaced deploy automation with a credential-free fork dry run pinned to an exact data SHA. Automation targets only `CodWasTaken/*`.
- Added an isolated `perkcommons-next-fork-dev` Worker environment for local and later `workers.dev` testing, with distinct rate-limit namespaces, no custom route, no cron and no GitHub automation secrets.
- Added static-asset security headers so pages that bypass Worker execution receive the same report-only CSP and browser protections.
- Added architecture, migration, moderation, search, deployment, security, risk, governance, and implementation-status documentation.

## Forks and branches

| Fork | Official read-only upstream | Local branch |
| --- | --- | --- |
| `https://github.com/CodWasTaken/site` | `https://github.com/PerkCommons/site` | `next/foundation` |
| `https://github.com/CodWasTaken/data` | `https://github.com/PerkCommons/data` | `next/schema-v2` |
| `https://github.com/CodWasTaken/docs` | `https://github.com/PerkCommons/docs` | `next/governance` |
| `https://github.com/CodWasTaken/branding` | `https://github.com/PerkCommons/branding` | `next/accessibility` |

The site's nested `.data` clone is also on `next/schema-v2`, with the personal data fork as `origin` and push-disabled official upstream.

## Commits

Changes are committed using narrowly scoped conventional subjects. The availability audit is data commit `db80383`; run the following in each fork for the complete immutable history:

```bash
git log --oneline origin/main..HEAD
```

Only the personal fork branches were pushed. No official branch, pull request or repository was targeted.

## Validation executed

| Repository | Command | Result |
| --- | --- | --- |
| data | `npm ci` | completed; no credentials used |
| data | `npm run check` | generated artifacts, 289 scope decisions and all 1,068 availability decisions current; all mixed-schema records valid |
| data | `npm test` | 19 passed, 0 failed |
| data | `npm run research:availability` | 1,068 records checked against 1,050 distinct HTTPS sources; full JSON and human-readable reports generated |
| data | `npm run reports -- --as-of 2026-07-23` | all required scope/quality/duplicate/stale reports regenerated; 289 excluded and 779 default-eligible |
| data | `npm run migrate:v2` | 1,068/1,068 results valid; 779 v1 migrated in memory, 289 v2 validated, 10,448 unresolved markers; no records written |
| data | `npm audit` | 0 known vulnerabilities after transitive lock update |
| site | `npm ci` | completed; no credentials used |
| site | `npm run check` | Astro and TypeScript checks passed |
| site | `npm test` | 53 passed, 0 failed |
| site | greenfield SQL on disposable PostgreSQL 17 | schema and end-to-end RPC smoke test passed; real pg_cron was represented by matching local signatures |
| site | `npm run build` | 1,095 static routes built; 779 default-eligible detail pages indexed |
| site | `npm run test:browser` | final full Chromium desktop/mobile run: 54 passed, 4 intentionally skipped, 0 failed |
| site | `npm run worker:dry-run` | Wrangler 4.113.0 read 3,064 assets for the named `dev` environment and exited without authentication or deployment |
| site | local `wrangler dev --env dev --local` smoke | homepage and six security headers, catalogue API and sitemap returned 200; unknown API returned 404 |
| site | hosted `perkcommons-next-fork-dev` smoke | homepage, listing, catalogue API, sitemap and Supabase-backed listing state returned 200; unknown API returned 404; six security headers present |
| branding | `jq empty` plus SVG presence checks | passed |
| docs | exact offline Lychee workflow | not run: Lychee is not installed locally |

The site audit still reports three high-severity development-tool advisories inherited through Wrangler/Miniflare's `sharp`. npm offers an old Wrangler downgrade rather than a compatible fix. This is R21 in the risk register and is not silently treated as resolved.

## Local preview

From `site`:

```bash
npm ci
npm run build
npm run preview -- --host 127.0.0.1 --port 4322
```

Open `http://127.0.0.1:4322/`. The build resolves the adjacent isolated `data` fork. Browser-test screenshots and traces are generated under ignored `test-results/`; no screenshots contain production credentials.

The isolated hosted test Worker is available at
`https://perkcommons-next-fork-dev.cod3eater.workers.dev`. Immutable deployment
versions can be inspected with `wrangler versions list --env dev`; the handoff
does not label one mutable deployment as production. The Worker has no
custom-domain route, cron, GitHub automation credentials, Turnstile secret or
tombstone KV binding and must not be represented as the official site.

## Known limitations and deferred work

- Availability/source research is not approval. Automated research never creates human-review provenance; the generated 2026-09-29 queue contains 1,061 records requiring real human source review, including 332 records with no review timestamp.
- The 2026-09-29 network audit checked 1,086 published URLs and found 0 confirmed broken URLs. Transient/server-side failures are classified as ambiguous; the audit is a transport/source-health check, not a claim that every source's content is semantically correct.
- The search index is lazy but remains approximately 1 MB uncompressed. Shard-first loading and representative ranking fixtures remain work.
- Provider pages, original audience guides, comparison UI, separate sitemaps, structured deadlines, and benefit-aware sorting are deferred.
- Submission tracking references, correction/withdrawal flows, and multiple structured evidence inputs remain deferred.
- The unconfirmed queue is now a focused browser module, but the remaining
  moderation UI still needs modular state, saved views, dedicated private
  detail/reveal auditing, selectable publication batches, operational metrics,
  and richer report decisions.
- Supabase project `fspdxfhijtlebdnftkof` is now the authorized canonical PerkCommons backend. Its live schema was reconciled in place rather than reset or replayed from the historical greenfield baseline; listing-update, review-concurrency and publication-semantics fields are present. Existing approvals still require human re-review before v2 publication.
- The historical greenfield baseline remains useful only for creating a new empty project; it must not be replayed onto the promoted live database.
- Edge tombstones require an isolated KV namespace before hosted testing. No namespace was created and no production binding was contacted.
- Hosted test submissions are not yet Turnstile-protected; do not promote or broadly advertise the test Worker before the fork-only widget is configured.
- GitHub App authentication, exact hosted deployment state, production-equivalent smoke verification, and publication/removal dashboards remain proposals.
- Firefox, WebKit/Safari, Axe, screen-reader, forced-colors, high-contrast, 200%/400% zoom, and manual device verification remain outstanding.
- CSP is report-only by design; enforcement requires a fork report-collection period and inline-script remediation.

## Security and privacy considerations

- Do not add production credentials to `.env.production`, Wrangler configuration, CI, fixtures, screenshots, or documentation.
- Keep test Worker secrets only in ignored `.dev.vars.dev` and the named Cloudflare `dev` environment. The current tracked `.env.production` working-tree change must remain uncommitted or be moved to an ignored local override before any push.
- A hosted fork must use isolated Supabase, Cloudflare, Turnstile, GitHub App, KV, and rate-limit resources.
- Require `TOMBSTONE_STORE` for any production-like environment and define reason-sensitive failure policy before launch.
- Preserve HttpOnly, Secure, SameSite, role, same-origin, service-role, and raw-IP protections.
- Do not expose contributor or reporter identities in queue summaries. A future reveal action must be deliberate and audited.
- Do not publish migrated or imported records without a human review event.

## Database and deployment requirements

1. Treat Supabase project `fspdxfhijtlebdnftkof` as the canonical backend; use forward-only migrations and do not replay the greenfield baseline onto it.
2. Preserve least-privilege RLS/RPC access, service-role isolation, review provenance, retention scheduling and publication/removal separation.
3. Pin the release candidate to an exact `CodWasTaken/data` commit with `PERKCOMMONS_RELEASE_CANDIDATE=1` and `PERKCOMMONS_DATA_REF=<40-character SHA>`.
4. Deploy only to Vercel's non-canonical hostname first; keep `PUBLIC_SITE_URL` on that staging origin and do not point it at `perkcommons.com` yet.
5. Verify homepage/listing/API/sitemap responses, security headers, noindex/canonical behavior, exact data SHA, submission/report/moderation/publication/update/removal paths, reconciliation cron and logs.
6. Promote the exact verified site/data revisions to `main` only after hosted verification; perform `perkcommons.com` DNS/domain/canonical cutover as a separate later step.

## Later transfer to official repositories

Authorization for the `CodWasTaken/*` main promotion has now been given. Promotion still follows the release-candidate gates above; the public-domain cutover remains deferred until hosted verification is complete. For any later transfer to a different repository owner:

1. Re-verify the authorization and record its scope.
2. Fetch official upstreams without changing their settings or branches.
3. Create new, focused official integration branches; do not merge the experimental branches wholesale.
4. Fetch the authorized official upstream, review both `git log origin/main..HEAD` and `git log upstream/main..HEAD`, then cherry-pick only approved, independently reviewable commits in dependency order: schema/data tooling, site consumption, Worker safety, moderation migration, then documentation.
5. Replace fork identifiers only through a reviewed configuration change. Do not copy fork placeholders or isolated resource IDs into production.
6. Regenerate artifacts and reports from the exact approved data revision.
7. Run clean installs, checks, unit tests, build, browser/accessibility suites, SQL integration tests, and Wrangler dry run.
8. Conduct privacy, security, editorial, accessibility, governance, and migration reviews.
9. Open separate official pull requests only if explicitly authorized, with no automatic publication or deployment.
10. Deploy only after separate explicit production authorization, exact-SHA verification, rollback preparation, and human approval.

## Promotion safety status

The release work is confined to `CodWasTaken/*` branches plus the explicitly authorized Supabase project `fspdxfhijtlebdnftkof`. `perkcommons.com` has not been changed. Vercel hosted verification is still blocked because the connected Vercel team currently exposes zero projects through the connector, so no site-main or domain promotion should occur until that hosted gate is completed.