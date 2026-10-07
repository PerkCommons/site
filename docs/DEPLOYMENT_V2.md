# Deployment version 2

PerkCommons production is hosted on Cloudflare Workers. The canonical source
repositories are `PerkCommons/site` and `PerkCommons/data`.

## Immutable release inputs

A production release is manually dispatched from `PerkCommons/site@main` with
an exact 40-character `PerkCommons/data` commit SHA. The workflow validates
the site commit, data commit, schema/taxonomy metadata, static assets, site
quality audit, Cloudflare Worker package, and browser regression suite before
any production deployment is created.

## Cloudflare release flow

The release workflow:

1. checks out the exact site and data revisions;
2. runs the full unit/contract suite;
3. builds the production artifact with the exact data checkout;
4. verifies embedded release metadata and static assets;
5. runs the site-quality audit and a Wrangler dry run;
6. runs browser regression tests;
7. rebuilds the exact artifact inside the protected `production` environment;
8. deploys to the existing `perkcommons-site` Worker with Wrangler while
   preserving dashboard-managed variables and secrets.

The production concurrency group does not cancel an in-progress release, so a
new dispatch cannot silently replace a release already being validated or
deployed.

The Worker `workers.dev` hostname is protected by Cloudflare Access. New
production revisions should be checked there by an authorized operator before
changing custom-domain or DNS routing.

## Required GitHub configuration

Protected `production` environment secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Repository variables used by the production build:

- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `PUBLIC_TURNSTILE_SITE_KEY`

The `production` environment should remain restricted to protected branches.
Required reviewers may be added when supported by the repository plan.

## Cloudflare Worker configuration

The canonical production Worker is `perkcommons-site`. Runtime secrets are
managed in Cloudflare and are not stored in git. The Worker currently requires
Supabase, submission-fingerprint, Turnstile, and GitHub publication/deployment
credentials.

The checked-in `wrangler.jsonc` is the source of truth for non-secret Worker
bindings, canonical GitHub targets, rate limits, static assets, cron triggers,
and observability.

## DNS and custom-domain cutover

Do not change production DNS until the new Worker revision has passed the
Access-protected `workers.dev` smoke test. During a hosting migration, keep the
previous origin reachable as rollback until Cloudflare custom domains are
attached and the apex/www routes have been verified.

## Rollback

Use Cloudflare Workers version/deployment rollback to restore a previously
verified Worker revision. Do not rebuild merely to roll back. After rollback,
verify the apex/www routes, catalogue/API, sitemap, security headers, cron/API
behavior, and exact release metadata.
