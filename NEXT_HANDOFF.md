# PerkCommons production handoff

Updated 2026-10-07.

## Canonical repositories

- Site: `PerkCommons/site`
- Data: `PerkCommons/data`

## Production hosting

Production is hosted on Cloudflare Workers using the canonical Worker
`perkcommons-site`.

- `https://perkcommons.com` is the canonical public origin.
- `https://www.perkcommons.com` redirects permanently to the apex while
  preserving path and query string.
- HTTP redirects to HTTPS.
- Cloudflare Access protects the `workers.dev` hostname used for pre-cutover
  operator smoke testing.
- Cloudflare's repository Build integration is disconnected; GitHub Actions is
  the sole production release path.

## Release flow

The protected `production` GitHub environment validates an exact site/data
pair and deploys it with Wrangler. The release workflow requires the exact
40-character data commit and runs unit/contract tests, the production build,
metadata verification, site-quality audit, Wrangler dry run, and browser
regression tests before deployment.

See `docs/DEPLOYMENT_V2.md` for the current runbook.

## Runtime boundaries

Cloudflare Workers serves the static assets and dynamic API/moderation routes.
Runtime secrets remain in Cloudflare and are never committed. Publication and
removal reconciliation dispatch the GitHub production workflow with the exact
merged data commit.

## Current follow-up work

- Keep Cloudflare and GitHub deployment credentials rotated and scoped.
- Enable Supabase leaked-password protection.
- Exercise a real moderator authenticated session and the valid-secret cron
  reconciliation path.
- Continue dependency cleanup and data-quality/human-review work.
