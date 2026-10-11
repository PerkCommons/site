# PerkCommons Site

Static Astro frontend and thin Cloudflare Worker API for the PerkCommons public
index. Published listing data is read from the separate `PerkCommons/data`
repository at build time. Private submission and moderation data stays in
Supabase and is never included in static HTML or Pagefind.

## Local development

```sh
npm ci
npm run fetch:data
npm run dev
```

Create `.env.local` from `.env.example` with the two `PUBLIC_` values for Astro.
The public Supabase key is used only for moderator authentication; it has no
direct access to moderation tables.

To exercise Worker APIs locally, copy the environment-specific, ignored Worker
secret template and fill it with credentials from the isolated fork Supabase
project:

```sh
cp .dev.vars.dev.example .dev.vars.dev
npm run dev:worker
```

This starts the named `dev` environment locally. It uses the
`perkcommons-next-fork-dev` Worker configuration, test-only rate-limit
namespaces, no custom-domain route, no cron triggers, and no GitHub publication
or deployment credentials. Turnstile remains disabled until its fork-only
widget is configured.

`npm run fetch:data` replaces `.data/` with a shallow clone of the public
dataset. Production builds run it automatically. Set
`PERKCOMMONS_DATA_PATH=/path/to/opportunities` to use another checkout. The
path must point directly to the directory containing the opportunity JSON files.
The site bundles a generated taxonomy snapshot for Worker validation. After a
taxonomy change, run `npm run sync:taxonomy`; `npm run check` verifies that the
snapshot matches the canonical data repository.

## Moderation

The moderation architecture, migration procedure, role bootstrap, security
model, privacy behavior, API routes, and operational checklist are documented
in [docs/MODERATION.md](docs/MODERATION.md).

Apply Supabase migrations in filename order before deploying Worker changes.
`202607180001_opportunity_taxonomy.sql` adds and backfills the primary category,
subcategory, and tag fields required by the expanded taxonomy. Until required
migrations and Worker secrets are configured, public submissions and moderation
APIs will return a temporary service error.

## Testing

```sh
npm run check
npm test
npm run build
npm run test:browser
```

Browser tests mock Supabase and moderation APIs. They do not write to the
production project.

## Fork Worker validation

Generate and check the Cloudflare binding contract, then create a deployment
bundle without authenticating or deploying:

```sh
npm run worker:types
npm run worker:dry-run
```

If a hosted test Worker is authorized later, deploy only the named environment
with `npx wrangler deploy --env dev`. It publishes to the distinct
`perkcommons-next-fork-dev` Worker on `workers.dev`; do not add a
`perkcommons.com` route. Set runtime values with
`npx wrangler secret put <NAME> --env dev`; never place the service-role key or
fingerprinting secret in build variables, frontend code, or tracked files.

Wrangler deploys `dist/` through Workers Static Assets and runs
`worker/index.ts` first for `/api/*` and `/moderate/*`. The canonical public URL
of the official project remains `https://perkcommons.com`; this fork must not
claim or modify it.

## Public activity counters and analytics consent

The common public footer reports **participating** monthly browsers, browsers
active in the last five minutes, and deduplicated opportunity opens. These are
approximate metrics, not all visitors or unique people. Counters use a SQLite
Cloudflare Durable Object restricted to the EU jurisdiction. Legacy counters
from before the opt-in migration are cleared and not moved. History begins with
the compliant new store, not with earlier analytics deployments.

No monthly browser ID or activity POST is generated before informed opt-in.
A non-blocking equal-choice consent panel appears on public pages for visitors
without a current choice. Rejection never restricts site access. Consent and
rejection are stored locally to honor preferences, with re-prompt after 180 days;
the footer and privacy page provide a persistent control to change the choice.
DNT/GPC signals disable tracking regardless of the stored preference. Rejecting
or withdrawing erases browser IDs and sends (or retries) a DELETE request to
remove the pseudonymous current-month records. Monthly identifiers are purged
when the month changes; presence after five minutes; listing de-duplication
after 30 minutes. Cumulative view totals are identifier-free. Cloudflare
rate limits and HMAC hashing protect the public endpoints. Browser tests check
pre-consent network activity, both choices and revocation. No third-party
analytics code is loaded.

The privacy page describes the controller, lawful bases, processors, data
retention, data-subject rights and UODO complaint channel. The operator must
independently confirm Cloudflare account DPA/transfer settings and Polish legal
obligations with qualified counsel; source changes alone are not a legal
certification. Do not use these numbers to claim total human audience size.
