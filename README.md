# PerkCommons Site

Static Astro frontend for the PerkCommons public index, deployed with Cloudflare
Workers Static Assets. Published listing data is read from the separate `PerkCommons/data`
repository at build time. The only dynamic route is the reviewed submission
intake at `functions/api/submissions.ts`.

## Local development

```sh
npm ci
npm run fetch:data
npm run dev
```

`npm run fetch:data` replaces `.data/` with a shallow clone of the public dataset.
Production builds run this command automatically. To use an existing checkout
instead, set `PERKCOMMONS_DATA_PATH=/path/to/listings` for commands that read the
dataset.

## Deployment

Configure the Cloudflare Git integration with:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`

The build fetches the public dataset, generates static HTML, and creates the
Pagefind index. Wrangler deploys `dist/` using Workers Static Assets. For GitHub
Actions deployment, configure `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID`. Store Supabase and Turnstile credentials as Cloudflare
Worker secrets, never as repository variables exposed to the static build.

Apply `worker/schema.sql` in Supabase before enabling submissions. The service
role key is Worker-only and must never use the `PUBLIC_` prefix.
