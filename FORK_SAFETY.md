# PerkCommons repository migration record

The experimental fork phase ended on 2026-10-06. The canonical repositories are now:

- site: <https://github.com/PerkCommons/site>
- data: <https://github.com/PerkCommons/data>

Both official `main` branches were fast-forwarded from the previously active
`CodWasTaken/site` and `CodWasTaken/data` forks after verifying that the
official branches were strict ancestors. No history was rewritten.

The personal forks remain useful as historical fork-network references, but
they are no longer canonical release or automation targets. Local site/data
clones should use `PerkCommons/*` as `origin`. A separate read-only
`fork` remote may point at `CodWasTaken/*` when historical comparison is
useful.

## Current safety commitments

- Production publication and release automation targets only reviewed
  `PerkCommons/*` repositories.
- `FORK_ONLY_MODE` remains available as an explicit opt-in safety guard for
  isolated testing; it is not the production default.
- Production releases use exact site/data commits, validate the Cloudflare
  Worker package, and deploy the tested artifact to the canonical
  `perkcommons-site` Worker through the protected GitHub `production`
  environment.
- Production credentials stay in protected platform secrets. They must not be
  copied into repository files, logs, fixtures, screenshots, or documentation.
- Historical fork-era plans and specs remain unchanged where they document the
  state that existed at the time.
