# Security and privacy version 2

The canonical site preserves HttpOnly/Secure/SameSite cookies, same-origin mutation checks, role checks, service-role isolation, keyed IP/email/user-agent fingerprints and private-table boundaries.

## Implemented controls

- One central Worker response wrapper sets CSP report-only, strict referrer policy, a restrictive permissions policy, nosniff, HSTS and COOP.
- Production mode rejects one-sided Turnstile client/server configuration.
- Submission and report rate-limit bindings are separate; login and tracking bindings are reserved for their own routes.
- Edge tombstones precede cache and Supabase checks; a tombstoned detail route returns 410.
- Tombstones are written before Git removal preparation when the isolated binding is configured.
- The tracked production env file contains placeholders only.
- Publication code targets the canonical `PerkCommons/data` repository. Production releases validate exact site/data commits and deploy through the protected Cloudflare Workers release workflow; fork-only targeting remains an explicit opt-in safety mode.

## Session migration proposal

The current app stores a reusable Supabase access token in a one-hour HttpOnly cookie. Do not replace it with a weaker browser-readable token. The target is a short-lived Worker-signed opaque session containing only session ID, role snapshot/version, issued/expiry timestamps and a rotation counter. Supabase authentication happens once; the reusable token is retained only server-side or exchanged for revocable session state. Role and account revocation must invalidate sessions promptly. Key rotation, CSRF/same-origin behavior and audit events require threat modeling before implementation.

## Configuration health

An admin-only health endpoint should report boolean/status values—not secrets—for Turnstile pairing, Supabase connectivity, expected migration, retention run age, GitHub App installation, tombstone store read/write probe and deployment integration. Production must fail closed for incomplete Turnstile and missing sensitive-removal storage.

## CSP adoption

CSP starts report-only because current pages include inline Astro scripts and Turnstile frames. Collect reports in an isolated preview, inventory violations, move inline code to bundled modules or nonces/hashes, test login/submission/moderation, then enforce. Do not weaken the policy simply to silence reports.

## Deferred privacy controls

Queue summaries still include too much private data; contributor email reveal is not yet audited; listing-report IDs are not checked against a canonical/tombstone index; duplicate report prevention, tracking rate limit and privacy operations dashboard remain required. No production security claim should include these deferred controls.
