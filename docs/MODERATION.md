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

Approval does not publish a listing. A later trusted integration can read
`normalized_opportunities` and prepare a draft pull request for
`PerkCommons/data`.

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
```

Configure production secrets with:

```sh
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_PUBLISHABLE_KEY
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put SUBMISSION_FINGERPRINT_SECRET
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Generate `SUBMISSION_FINGERPRINT_SECRET` with at least 32 random bytes. Never
reuse it for another application purpose.

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

## API routes

Public:

```text
POST /api/submissions
POST /api/reports
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
```

Admin:

```text
GET    /api/moderation/bans
POST   /api/moderation/bans
DELETE /api/moderation/bans/:id
GET    /api/moderation/moderators
POST   /api/moderation/moderators
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

- [ ] Review and apply the Supabase migration.
- [ ] Create the first Auth user and administrator profile.
- [ ] Set all Cloudflare build variables and Worker runtime secrets.
- [ ] Configure Turnstile and confirm the `SUBMISSION_RATE_LIMITER` binding.
- [ ] Run `npm ci`, `npm run check`, `npm test`, `npm run build`, and
      `npm run test:browser`.
- [ ] Confirm `/moderate/` redirects without a valid moderator cookie.
- [ ] Confirm reviewer and admin permissions with separate test accounts.
- [ ] Submit a non-production test record and verify country/fingerprint fields.
- [ ] Apply the retention migration and inspect its first scheduled run.
