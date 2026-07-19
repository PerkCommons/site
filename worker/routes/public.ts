import {
  keyedFingerprint,
  normalizeIpAddress,
  normalizeUserAgent,
} from "../lib/fingerprints";
import { apiError, json, readJson, RequestError } from "../lib/http";
import { strongestBanMode } from "../lib/moderation-policy";
import { insertRows, supabaseRequest } from "../lib/supabase";
import type { Env } from "../lib/types";
import {
  normalizeCountryCode,
  validateReport,
  validateSubmission,
} from "../lib/validation";

const genericSuccess = () => json({ message: "Submitted for review." }, 201);

async function verifyTurnstile(
  env: Env,
  token: string | null,
  ip: string | null,
  expectedAction: "public-submission" | "public-report",
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return true;
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token ?? "",
  });
  if (ip) body.set("remoteip", ip);
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  );
  if (!response.ok) {
    console.warn(
      JSON.stringify({
        event: "turnstile_siteverify_unavailable",
        status: response.status,
      }),
    );
    return false;
  }
  const result = (await response.json()) as {
    success?: boolean;
    "error-codes"?: string[];
    action?: string;
    hostname?: string;
  };
  const valid = result.success === true && result.action === expectedAction;
  if (!valid) {
    console.warn(
      JSON.stringify({
        event: "turnstile_verification_failed",
        errors: result["error-codes"]?.slice(0, 5) ?? [],
        action: result.action ?? null,
        hostname: result.hostname ?? null,
      }),
    );
  }
  return valid;
}

async function isRateLimited(
  env: Env,
  ipHash: string | null,
  kind: "submission" | "report",
): Promise<boolean> {
  if (!ipHash) return false;
  if (
    env.SUBMISSION_RATE_LIMITER &&
    !(await env.SUBMISSION_RATE_LIMITER.limit({ key: ipHash })).success
  )
    return true;
  const since = new Date(Date.now() - 60 * 60 * 1_000).toISOString();
  const query =
    kind === "submission"
      ? `/rest/v1/submission_fingerprints?ip_hash=eq.${ipHash}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=6`
      : `/rest/v1/listing_reports?reporter_ip_hash=eq.${ipHash}&created_at=gte.${encodeURIComponent(since)}&select=id&limit=6`;
  const { data } = await supabaseRequest<Array<{ id: string }>>(env, query);
  return data.length >= 5;
}

async function matchingBanMode(
  env: Env,
  emailHash: string | null,
  ipHash: string | null,
): Promise<"block" | "flag" | "warn" | null> {
  const filters = [
    emailHash
      ? `and(identifier_type.eq.email,identifier_hash.eq.${emailHash})`
      : null,
    ipHash ? `and(identifier_type.eq.ip,identifier_hash.eq.${ipHash})` : null,
  ].filter(Boolean);
  if (filters.length === 0) return null;
  const query = `/rest/v1/moderation_bans?active=eq.true&or=(${filters.join(",")})&select=mode,expires_at`;
  const { data } = await supabaseRequest<
    Array<{ mode: "block" | "flag" | "warn"; expires_at: string | null }>
  >(env, query);
  return strongestBanMode(data.map((ban) => ({ ...ban, active: true })));
}

const requestSignals = async (
  request: Request,
  env: Env,
  email: string | null,
) => {
  const rawIp = normalizeIpAddress(
    request.headers.get("CF-Connecting-IP") ?? "",
  );
  const country = normalizeCountryCode(request.cf?.country);
  const emailHash = await keyedFingerprint(
    env.SUBMISSION_FINGERPRINT_SECRET,
    "email",
    email,
  );
  const ipHash = await keyedFingerprint(
    env.SUBMISSION_FINGERPRINT_SECRET,
    "ip",
    rawIp,
  );
  const userAgentHash = await keyedFingerprint(
    env.SUBMISSION_FINGERPRINT_SECRET,
    "user-agent",
    normalizeUserAgent(request.headers.get("user-agent")),
  );
  return { rawIp, country, emailHash, ipHash, userAgentHash };
};

export async function handlePublicSubmission(
  request: Request,
  env: Env,
): Promise<Response> {
  const input = validateSubmission(await readJson(request));
  if (input.website) return genericSuccess();
  const signals = await requestSignals(request, env, input.submitter_email);
  if (await isRateLimited(env, signals.ipHash, "submission"))
    return apiError(
      "Too many submissions. Please try again later.",
      429,
      "rate_limited",
    );
  if (
    !(await verifyTurnstile(
      env,
      input.turnstile_token,
      signals.rawIp,
      "public-submission",
    ))
  )
    return apiError("Spam verification failed.", 400, "spam_check_failed");

  const banMode = await matchingBanMode(env, signals.emailHash, signals.ipHash);
  if (banMode === "block") return genericSuccess();
  const status = banMode === "flag" ? "flagged" : "pending";
  const rows = await insertRows<Array<{ id: string }>[number]>(
    env,
    "opportunity_submissions",
    {
      organization: input.organization,
      name: input.name,
      categories: input.categories,
      primary_category: input.primary_category,
      subcategories: input.subcategories,
      tags: input.tags,
      source_url: input.source_url,
      // Keep the legacy required column populated while existing deployments
      // transition to organization_website_url.
      website_url: input.organization_website_url ?? input.source_url,
      organization_website_url: input.organization_website_url,
      description: input.description,
      eligibility: input.eligibility,
      benefits: input.benefits,
      location: input.location,
      deadline: input.deadline,
      submitter_name: input.submitter_name,
      submitter_email: input.submitter_email,
      submitter_notes: input.submitter_notes,
      status,
      risk_score: banMode ? 50 : 0,
      submission_ip_hash: signals.ipHash,
      submission_email_hash: signals.emailHash,
      submission_country_code: signals.country,
      submission_user_agent_hash: signals.userAgentHash,
    },
  );
  const submissionId = rows[0]?.id;
  if (!submissionId)
    throw new Error("Submission insert returned no identifier");
  await insertRows(env, "submission_fingerprints", {
    submission_id: submissionId,
    email_hash: signals.emailHash,
    ip_hash: signals.ipHash,
    user_agent_hash: signals.userAgentHash,
    country_code: signals.country,
  });
  console.log(
    JSON.stringify({
      event: "submission_received",
      submissionId,
      category: input.primary_category,
      country: signals.country,
    }),
  );
  return genericSuccess();
}

export async function handlePublicReport(
  request: Request,
  env: Env,
): Promise<Response> {
  const input = validateReport(await readJson(request, 12_000));
  if (input.website) return genericSuccess();
  const signals = await requestSignals(request, env, input.reporter_email);
  if (await isRateLimited(env, signals.ipHash, "report"))
    return apiError(
      "Too many reports. Please try again later.",
      429,
      "rate_limited",
    );
  if (
    !(await verifyTurnstile(
      env,
      input.turnstile_token,
      signals.rawIp,
      "public-report",
    ))
  )
    return apiError("Spam verification failed.", 400, "spam_check_failed");
  await insertRows(env, "listing_reports", {
    listing_id: input.listing_id,
    reason: input.reason,
    details: input.details,
    reporter_email: input.reporter_email,
    reporter_email_hash: signals.emailHash,
    reporter_ip_hash: signals.ipHash,
    reporter_country_code: signals.country,
  });
  return genericSuccess();
}

export const handlePublicError = (error: unknown): Response => {
  if (error instanceof RequestError)
    return apiError(error.message, error.status, error.code);
  console.error(
    JSON.stringify({
      event: "public_api_failed",
      error: error instanceof Error ? error.name : "unknown",
    }),
  );
  return apiError(
    "The submission service is temporarily unavailable.",
    503,
    "service_unavailable",
  );
};
