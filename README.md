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

To exercise Worker APIs locally, create an ignored `.dev.vars` containing the
runtime variables from `.env.example`, then run:

```sh
npm run dev:worker
```

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

## Deployment

Configure the Cloudflare Git integration with:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` as Cloudflare
build variables and GitHub Actions repository variables. Set Worker runtime
values with `wrangler secret put`; never place the service-role key or
fingerprinting secret in build variables or frontend code.

Wrangler deploys `dist/` through Workers Static Assets and runs
`worker/index.ts` first for `/api/*` and `/moderate/*`. The canonical public URL
remains `https://perkcommons.com`.
