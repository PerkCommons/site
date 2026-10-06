# Deployment version 2

PerkCommons production is hosted on Vercel. The canonical source repositories
are `PerkCommons/site` and `PerkCommons/data`.

## Immutable release inputs

A production release is manually dispatched from `PerkCommons/site@main` with
an exact 40-character `PerkCommons/data` commit SHA. The workflow validates
the site commit, data commit, schema/taxonomy metadata, static assets, site
quality audit, and browser regression suite before any Vercel deployment is
created.

## Vercel release flow

The release workflow:

1. checks out the exact site and data revisions;
2. pulls the Vercel production configuration;
3. builds the production artifact with the exact data checkout;
4. creates a production deployment with `--skip-domain`;
5. smoke-tests the staged `*.vercel.app` deployment through Deployment Protection;
6. promotes that same tested deployment to the production domains.

The production concurrency group does not cancel an in-progress release, so a
new dispatch cannot silently replace a release that is already staging or
promoting.

## Required GitHub configuration

Repository variables:

- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `VERCEL_CLI_VERSION`

Protected environment secrets:

- `VERCEL_TOKEN`
- `VERCEL_AUTOMATION_BYPASS_SECRET`

The `production` environment should use required reviewers and a deployment
branch policy for `main` before the first automated release.

## Rollback

Use Vercel rollback/promote against a previously verified production deployment.
Do not rebuild merely to roll back: rollback should restore an already known
artifact. After any rollback, scan production logs and verify the apex/www
routes, catalogue/API, sitemap, security headers, and exact release metadata.
