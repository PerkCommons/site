# PerkCommons Site

Static Astro frontend for the PerkCommons public index, deployed to Cloudflare
Pages. Published listing data is read from the separate `PerkCommons/data`
repository at build time. The only dynamic route is the reviewed submission
intake at `functions/api/submissions.ts`.

## Local development

```sh
npm ci
npm run dev
```

The default data path is `../data/listings`. Override it with
`PERKCOMMONS_DATA_PATH=/path/to/listings`.

## Deployment

GitHub Actions checks out both repositories, builds static HTML, creates the
Pagefind index, and deploys `dist/`. Configure `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, and the Pages project. Store Supabase and Turnstile
credentials as Cloudflare Pages secrets, never as repository secrets exposed to
the static build.

Apply `worker/schema.sql` in Supabase before enabling submissions. The service
role key is Worker-only and must never use the `PUBLIC_` prefix.
