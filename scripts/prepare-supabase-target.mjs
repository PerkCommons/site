import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const projectUrl = "https://fspdxfhijtlebdnftkof.supabase.co";
if (process.env.PUBLIC_SUPABASE_URL?.trim() !== projectUrl) {
  throw new Error("Production switch blocked: set PUBLIC_SUPABASE_URL to " + projectUrl + " in GitHub Actions variables.");
}
const publishableKey = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const serviceKey = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY?.trim();

if (!serviceKey) {
  throw new Error(
    "Production switch blocked: add TARGET_SUPABASE_SERVICE_ROLE_KEY " +
    "to the PerkCommons/site GitHub production environment secrets. " +
    "Use the service-role JWT (or a Supabase secret key) from project fspdxfhijtlebdnftkof.",
  );
}
if (!publishableKey || !/^(sb_publishable_|eyJ)/.test(publishableKey)) {
  throw new Error("Production switch blocked: expected an active publishable Supabase key.");
}
if (!/^(sb_secret_|eyJ)/.test(serviceKey)) {
  throw new Error("Production switch blocked: expected a service-role JWT or Supabase secret key.");
}

const serviceHeaders = {
  apikey: serviceKey,
  ...(serviceKey.startsWith("sb_secret_")
    ? {}
    : { authorization: `Bearer ${serviceKey}` }),
};

async function verify(path, headers) {
  const response = await fetch(`${projectUrl}${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Supabase preflight failed for ${path.split("?")[0]} (HTTP ${response.status}). Check that the secret is from the intended project and has service-role privileges.`);
  }
  return response.json();
}

// Test access to both the actual moderation table and every column the Worker
// reads, before touching the production Worker or its credentials.
const columns = "id,name,organization,categories,primary_category,subcategories,tags,description,eligibility,benefits,location,deadline,source_url,organization_website_url,submitter_name,submitter_email,submitter_notes,status,risk_score,flag_count,submission_country_code,created_at,updated_at,reviewed_at,published_at,last_action_at,decision_reason,submission_kind,target_listing_id,proposed_by_moderator,original_created_at";
const rows = await verify(
  `/rest/v1/opportunity_submissions?status=in.(pending,reviewing)&select=${columns}&limit=1`,
  serviceHeaders,
);
if (!Array.isArray(rows)) throw new Error("Unexpected moderation query response.");

const admins = await verify(
  "/rest/v1/moderator_profiles?active=eq.true&role=eq.admin&select=role&limit=1",
  serviceHeaders,
);
if (!Array.isArray(admins) || admins.length === 0) {
  throw new Error("The target project has no active administrator; switch blocked.");
}
// The public key must not be able to read protected moderator tables.
// Verify the public Auth endpoint, not submission row access.
const authSettings = await verify("/auth/v1/settings", { apikey: publishableKey });
if (!authSettings || typeof authSettings !== "object" || Array.isArray(authSettings))
  throw new Error("Invalid public Auth settings response.");
await verify("/auth/v1/health", { apikey: publishableKey });

const directory = process.env.RUNNER_TEMP;
if (!directory) throw new Error("This script must run in GitHub Actions.");
await writeFile(
  join(directory, "perkcommons-supabase-secrets.json"),
  JSON.stringify({
    SUPABASE_URL: projectUrl,
    SUPABASE_PUBLISHABLE_KEY: publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  }),
  { mode: 0o600, flag: "wx" },
);
console.log("Supabase target verified: expected schema, moderator, auth and service access. Cloudflare secret bundle prepared.");
