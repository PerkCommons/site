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

## Public activity counters

The common public footer shows three first-party, approximate metrics: unique
browsers in the current UTC month, active browsers in the last five minutes,
and opportunity detail views since tracking started. Views are counted once per
browser/listing per 30 minutes, not on each heartbeat. Bots and opted-out
browsers are excluded. This is **not** a user count, sign-up count, or complete
traffic audit. Counts start at zero on initial deployment, with no historical
backfill. The 404 and moderator pages omit the widget.

`/api/site-stats` reads and records events using the `SiteStats` SQLite Durable
Object binding (`wrangler.jsonc`). The public browser script sends pseudonymous,
first-party browser IDs over same-origin requests; the Worker HMACs them before
persistence. The private DO stores only opaque hashes and counts, with monthly
records retained for 13 months, presence for 5 minutes and view de-duplication
for 30 minutes. No third-party analytics code is loaded. See `/privacy/` for
the browser opt-out. DNT and GPC are respected. Do not use the numbers to claim
precise human audience size, and review regional analytics consent requirements
before advertising.
