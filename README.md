# PerkCommons Site

Static Astro frontend for the PerkCommons public index, deployed with Cloudflare
Workers Static Assets. Published listing data is read from the separate `PerkCommons/data`
repository at build time. Opportunity submissions are written directly to
Supabase and remain unpublished until moderator review.

## Local development

```sh
npm ci
npm run fetch:data
npm run dev
```

Create `.env.local` before starting the site:

```sh
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your-key
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

Set `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` as build
variables in Cloudflare. Set the same names as GitHub Actions repository
variables when using the included CI or manual deployment workflow. These are
public browser credentials; never expose a Supabase secret or service-role key.

The build fetches the public dataset, generates static HTML, and creates the
Pagefind index. Wrangler deploys `dist/` using Workers Static Assets. For GitHub
Actions deployment, configure `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` as secrets. Supabase Row Level Security must allow only
the intended anonymous insert operation on `opportunity_submissions`; browser
clients must not be able to read, update, or delete moderation records.
