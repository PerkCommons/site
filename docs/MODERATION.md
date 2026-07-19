# Moderation System

## Architecture

The public site remains statically generated. Cloudflare runs `worker/index.ts`
only for API routes and the protected moderation route, then delegates public
assets to the `ASSETS` binding.

```text
Public form -> Cloudflare Worker -> validation and abuse checks -> Supabase
Moderator -> Supabase Auth -> HttpOnly Worker session -> role-checked API -> Supabase
```

The browser publishable key is used to authenticate a moderator. After sign-in,
the browser sends the short-lived Supabase access token to `/api/auth/session`.
The Worker validates the token and active `moderator_profiles` record before
setting a `Secure`, `HttpOnly`, `SameSite=Strict` cookie. Every protected API
request revalidates the user and role. Authenticated mutations also require a
same-origin `Origin` header.

The service-role key, ban identifiers, and IP/user-agent fingerprints are
Worker-only. The moderation queue does not return fingerprint hashes. RLS and
revoked grants provide a second boundary behind Worker authorization.

## Database migration

Apply the migration before deploying the Worker:

```sh
supabase db push
```

Alternatively, review and run
`supabase/migrations/202607170001_moderation_system.sql` in the Supabase SQL
editor. The migration:

- removes legacy direct-browser submission policies before changing the status
  column; the Worker API becomes the only submission writer;
- extends `opportunity_submissions` with review, country, risk, and private
  fingerprint fields;
- preserves original submitted fields and stores approved normalized data in
  `normalized_opportunities`;
- creates `moderator_profiles`, `moderation_actions`, `submission_flags`,
  `listing_reports`, `moderation_bans`, and `submission_fingerprints`;
- enables RLS and removes `anon` and `authenticated` table grants;
- adds role-checking transactional functions for moderation actions and undo;
- keeps ordinary moderation history append-only.

Apply migrations in filename order. Migration
`202607170003_submission_website_compatibility.sql` copies legacy
`website_url` values into `organization_website_url` and removes the obsolete
not-null requirement that predates the Worker submission API.

Migration `202607180001_opportunity_taxonomy.sql` adds canonical
`primary_category`, `subcategories`, and `tags` fields to submitted and
normalized opportunities. It backfills recognized legacy categories and
updates approval storage. Apply it before deploying a Worker that accepts the
expanded taxonomy.

Migration `202607190001_moderation_workspace.sql` adds audited featured and
removed state for Git-backed listings, explicit report decisions with notes,
and transactional rejected-submission cleanup. Apply it before deploying the
corresponding workspace and Worker changes.

Migration `202607190002_automated_publication.sql` adds private publication
batches and items plus transactional claim and finalization functions. Apply
it before enabling the Approved-queue publication control.

Migration `202607190003_automated_listing_removal.sql` adds private,
idempotent removal batches for upheld listing reports. It also queues existing
upheld reports so listings suppressed before the migration are removed from
the Git dataset without being reported again. Apply it before deploying the
automated removal Worker.

Approval and publication remain separate decisions. An administrator can use
**Publish all approved** to claim every approved normalized submission in one
batch. The Worker writes one branch and pull request in `PerkCommons/data`.
Its two-minute scheduled reconciler waits for the data repository's `validate`
check, merges only a successful head commit, marks the corresponding Supabase
submissions `published`, and dispatches the site's production deployment.
Retries reuse an active batch and never create duplicate publication actions.

## Moderator setup

1. Create the user in Supabase Authentication.
2. Copy the Auth user UUID.
3. Bootstrap the first administrator in the SQL editor:

```sql
insert into public.moderator_profiles (user_id, role)
values ('AUTH-USER-UUID', 'admin');
```

Admins can use the moderation workspace or `POST /api/moderation/moderators` to
add, deactivate, or change later moderator profiles. A normal authenticated Supabase account receives no
moderation access without an active profile. Reviewers can decide, flag,
unflag, annotate, undo, and resolve reports. Only admins can manage moderator
profiles and bans.

Pending submissions can be approved, declined, or flagged. Flagged submissions
can be approved, declined, or unflagged. The Worker rejects these transitions
from archive queues even if a client calls an endpoint directly.

Upholding a listing report immediately suppresses the listing on the public
site, makes its direct detail URL return `410 Gone`, and records the decision
and optional note. The Worker caches visible/removed checks at the edge for one
minute to limit database reads. It also creates a deletion pull request for the
exact stable listing ID in `PerkCommons/data`, waits for the repository's
`validate` check, merges the change, records the merge SHA, and dispatches a
production site rebuild. A missing data file is handled idempotently and still
triggers a rebuild. Dismissing a report keeps the listing public and does not
modify Git.

Moderators can feature a published listing from its public detail page. The
public state endpoint exposes only listing IDs and non-sensitive featured or
removed booleans; moderator identity and audit metadata remain private.

## Environment variables

Astro build variables:

```text
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_PUBLISHABLE_KEY
PUBLIC_TURNSTILE_SITE_KEY (optional)
```

Worker runtime values:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SERVICE_ROLE_KEY
SUBMISSION_FINGERPRINT_SECRET
TURNSTILE_SECRET_KEY (optional)
GITHUB_DATA_PUBLICATION_TOKEN
GITHUB_SITE_DEPLOY_TOKEN
```

Configure production secrets with:

```sh
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUBMISSION_FINGERPRINT_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put GITHUB_DATA_PUBLICATION_TOKEN
npx wrangler secret put GITHUB_SITE_DEPLOY_TOKEN
```

Generate `SUBMISSION_FINGERPRINT_SECRET` with at least 32 random bytes. Never
reuse it for another application purpose.

Use two separate fine-grained GitHub tokens:

- `GITHUB_DATA_PUBLICATION_TOKEN`: select only `PerkCommons/data`; grant
  repository **Contents: Read and write** and **Pull requests: Read and write**.
- `GITHUB_SITE_DEPLOY_TOKEN`: select only `PerkCommons/site`; grant repository
  **Actions: Read and write**.

Set expirations and rotate both tokens. Never use a broad classic personal
access token. The data repository must continue to require pull requests and
the strict `validate` status check. Because moderator approval is the human
editorial decision and the organization currently has one active maintainer,
set required GitHub approving reviews to zero for `data/main`; otherwise the
automated merge will remain blocked after validation. Keep force pushes,
deletions, and direct pushes disabled.

## Country and fingerprint behavior

Country is read only from Cloudflare `request.cf.country`, normalized to an ISO
3166-1 alpha-2 code, and may be unavailable during local development. The UI
uses `Intl.DisplayNames`, supplies an accessible textual label, and shows an
unknown-country fallback.

The Worker normalizes IPv4 and IPv6 addresses and computes namespaced HMAC
SHA-256 fingerprints for IP, normalized email, and a bounded lowercase user
agent. Raw IP addresses are not stored or logged. Email ban hints are masked.
These signals are useful for rate limits and repeated-abuse review, but shared
networks, VPNs, mobile address changes, disposable email, and geographic
routing create false positives. Country, IP, email, user agent, and risk scores
must never be the sole reason to reject or ban.

Rotating `SUBMISSION_FINGERPRINT_SECRET` prevents new submissions from matching
old fingerprints and bans. Plan a rotation window: disable fingerprint-based
bans, rotate the Worker secret, expire or archive old hashes, and create new
bans only from submissions fingerprinted with the new key. Never retain the old
secret in source control.

## Privacy and retention

Fingerprints and submitter contact details are private moderation data. The
project has adopted this retention schedule:

| Data | Retention |
| --- | --- |
| Pending, reviewing, or flagged submissions | Human review required after 180 days; no automatic decision |
| Submitter contact details and fingerprints after rejection, withdrawal, or publication | 90 days |
| Resolved report contact details and fingerprints | 90 days |
| Expired temporary ban records | 90 days after expiry |
| Permanent bans | Manual review every 12 months |
| Sensitive internal notes and resolved report details | 1 year |
| Minimal moderation actions, resolved flags, and resolved reports | 3 years |
| Normalized public opportunity data | Indefinite while useful |

`supabase/migrations/202607170002_moderation_retention.sql` installs
`apply_moderation_retention()` and schedules it daily at 03:23 UTC with
Supabase Cron. The function redacts private fields, deletes expired private
records, and writes aggregate counts to the RLS-protected
`moderation_retention_runs` table. It only reports submissions awaiting review
for more than 180 days and permanent bans older than one year; it does not make
those human decisions. The initial accountable maintainer, `CodWasTaken`,
reviews those counts quarterly. The canonical public policy and decision record
live in the `PerkCommons/docs` repository.

`supabase/migrations/202607190001_moderation_workspace.sql` replaces that
function with the same retention schedule using the current `upheld` and
`dismissed` terminal report statuses. Apply it after the original moderation
and retention migrations.

The cleanup function is the only privileged exception to append-only
moderation history. It removes sensitive notes after one year and complete
audit events after three years according to the adopted policy. Changes to
these periods require a policy update, ADR, and migration review.

After applying the migration, verify the schedule and inspect completed runs:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'perkcommons-moderation-retention';

select ran_at, results
from public.moderation_retention_runs
order by ran_at desc
limit 20;
```

Administrators may execute `select public.apply_moderation_retention();` from
the Supabase SQL editor for an initial run. The function is idempotent and its
aggregate result contains no contact data or fingerprints.

The full copy brief contains private submitter and moderation information and
displays a warning. The redacted brief excludes submitter identity, private
notes, fingerprints, internal moderator identity, and ban metadata. Do not paste
an unredacted brief into an untrusted third-party service.

The Rejected queue provides individual and bulk permanent deletion controls.
These are intentionally explicit and confirmed: automatically deleting at the
moment of rejection would break the ten-second Undo promise and erase evidence
before the adopted retention review. Every purge writes an audit snapshot
before cascading private submission and fingerprint rows.

## API routes

Public:

```text
POST /api/submissions
POST /api/reports
GET  /api/listings/state
POST /api/auth/session
POST /api/auth/logout
GET  /api/auth/me
```

Moderator:

```text
GET  /api/moderation/queue
GET  /api/moderation/submissions/:id
POST /api/moderation/submissions/:id/approve
POST /api/moderation/submissions/:id/decline
POST /api/moderation/submissions/:id/flag
POST /api/moderation/submissions/:id/unflag
POST /api/moderation/submissions/:id/undo
POST /api/moderation/submissions/:id/notes
GET  /api/moderation/reports
POST /api/moderation/reports/:id/resolve
POST /api/moderation/listings/:id/feature
DELETE /api/moderation/submissions/:id
DELETE /api/moderation/rejected
```

Admin:

```text
GET    /api/moderation/bans
POST   /api/moderation/bans
DELETE /api/moderation/bans/:id
GET    /api/moderation/moderators
POST   /api/moderation/moderators
GET    /api/moderation/publications
POST   /api/moderation/publications
```

All payloads are size-limited and validated. Errors use a consistent
`{ "error": { "code": "...", "message": "..." } }` shape and do not include
database messages, ban matches, fingerprints, or credentials.

## Rate limiting and Turnstile

The Worker checks recent keyed IP fingerprints in Supabase and uses the native
Cloudflare rate-limit binding named `SUBMISSION_RATE_LIMITER`. The binding
allows five combined submission and report attempts per fingerprint per minute
at each Cloudflare location. Cloudflare's limiter is deliberately permissive
and eventually consistent, so the database-backed five-per-hour check remains
the durable second layer.
Turnstile verification is activated only when `TURNSTILE_SECRET_KEY` is set;
the browser widget is activated by `PUBLIC_TURNSTILE_SITE_KEY`. Configure both
or neither.

## Deployment checklist

- [ ] Review and apply `202607190001_moderation_workspace.sql` after the
      existing moderation and retention migrations.
- [ ] Apply `202607190002_automated_publication.sql`.
- [ ] Apply `202607190003_automated_listing_removal.sql`; this backfills
      removal batches for earlier upheld reports.
- [ ] Merge the matching `PerkCommons/data` schema-limit update.
- [ ] Configure the two fine-grained GitHub publication secrets.
- [ ] Keep the data `validate` check required and set required approving
      reviews to zero so moderator-approved batches can merge automatically.
- [ ] Confirm the `*/2 * * * *` publication reconciliation trigger in
      Cloudflare Workers.
- [ ] Create the first Auth user and administrator profile.
- [ ] Set all Cloudflare build variables and Worker runtime secrets.
- [ ] Configure Turnstile and confirm the `SUBMISSION_RATE_LIMITER` binding.
- [ ] Run `npm ci`, `npm run check`, `npm test`, `npm run build`, and
      `npm run test:browser`.
- [ ] Confirm `/moderate/` redirects without a valid moderator cookie.
- [ ] Confirm reviewer and admin permissions with separate test accounts.
- [ ] Submit a non-production test record and verify country/fingerprint fields.
- [ ] Apply the retention migration and inspect its first scheduled run.
