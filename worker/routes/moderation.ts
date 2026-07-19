import {
  clearSessionCookie,
  requireModerator,
  sessionCookie,
  authenticateToken,
} from "../lib/auth";
import { maskEmail } from "../lib/fingerprints";
import { actionAllowedForStatus } from "../lib/moderation-policy";
import {
  apiError,
  assertSameOrigin,
  json,
  readJson,
  RequestError,
} from "../lib/http";
import {
  callRpc,
  insertRows,
  SupabaseError,
  supabaseRequest,
} from "../lib/supabase";
import type { Env, Moderator, SubmissionStatus } from "../lib/types";
import {
  optionalNote,
  requiredChoice,
  safeHttpsUrl,
} from "../lib/validation";
import {
  isSubcategoryFor,
  normalizeCategoryId,
} from "../../src/lib/taxonomy";

const DECLINE_REASONS = new Set([
  "Duplicate",
  "Not a real opportunity",
  "Insufficient evidence",
  "Expired",
  "Misleading information",
  "Promotional spam",
  "Ineligible content",
  "Unsafe or suspicious",
  "Other",
]);
const FLAG_REASONS = new Set([
  "Needs deeper verification",
  "Possible scam",
  "Broken source",
  "Duplicate",
  "Incorrect details",
  "Privacy concern",
  "Conflict of interest",
  "Suspicious submitter",
  "Requires second reviewer",
  "Other",
]);
const QUEUES = new Set([
  "pending",
  "flagged",
  "approved",
  "rejected",
  "published",
]);

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RequestError("Invalid request body.", 400, "invalid_payload");
  return value as Record<string, unknown>;
};

const submissionSelect =
  "id,name,organization,categories,primary_category,subcategories,tags,description,eligibility,benefits,location,deadline,source_url,organization_website_url,submitter_name,submitter_email,submitter_notes,status,risk_score,flag_count,submission_country_code,created_at,updated_at,reviewed_at,published_at,last_action_at,decision_reason";

export async function createSession(
  request: Request,
  env: Env,
): Promise<Response> {
  assertSameOrigin(request);
  const body = asRecord(await readJson(request, 8_000));
  if (typeof body.access_token !== "string" || body.access_token.length > 8_000)
    throw new RequestError("Invalid session.", 400, "invalid_session");
  const moderator = await authenticateToken(env, body.access_token);
  if (!moderator)
    return apiError(
      "This account does not have active moderator access.",
      403,
      "not_moderator",
    );
  return json(
    { moderator: { email: moderator.email, role: moderator.role } },
    200,
    { "set-cookie": sessionCookie(body.access_token) },
  );
}

export async function destroySession(request: Request): Promise<Response> {
  assertSameOrigin(request);
  return json({ message: "Signed out." }, 200, {
    "set-cookie": clearSessionCookie(),
  });
}

export async function currentModerator(
  request: Request,
  env: Env,
): Promise<Response> {
  const moderator = await requireModerator(request, env);
  return json({ moderator: { email: moderator.email, role: moderator.role } });
}

export async function queue(request: Request, env: Env): Promise<Response> {
  await requireModerator(request, env);
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? "pending";
  const categoryParameter = url.searchParams.get("category");
  const category = categoryParameter
    ? normalizeCategoryId(categoryParameter)
    : null;
  if (!QUEUES.has(status))
    throw new RequestError("Unknown moderation queue.", 400, "invalid_queue");
  if (categoryParameter && !category)
    throw new RequestError("Unknown opportunity category.", 400, "invalid_category");
  const categoryFilter = category ? `&primary_category=eq.${category}` : "";
  const query = `/rest/v1/opportunity_submissions?status=eq.${status}${categoryFilter}&select=${submissionSelect}&order=created_at.asc&limit=50`;
  const { data } = await supabaseRequest<unknown[]>(env, query);
  return json({ queue: status, count: data.length, submissions: data });
}

export async function submissionDetail(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  await requireModerator(request, env);
  const [submission, flags, actions] = await Promise.all([
    supabaseRequest<unknown[]>(
      env,
      `/rest/v1/opportunity_submissions?id=eq.${encodeURIComponent(id)}&select=${submissionSelect}&limit=1`,
    ),
    supabaseRequest<unknown[]>(
      env,
      `/rest/v1/submission_flags?submission_id=eq.${encodeURIComponent(id)}&select=id,reason,notes,resolved,created_at&order=created_at.desc`,
    ),
    supabaseRequest<unknown[]>(
      env,
      `/rest/v1/moderation_actions?submission_id=eq.${encodeURIComponent(id)}&select=id,action,reason,notes,previous_status,new_status,created_at&order=created_at.desc&limit=30`,
    ),
  ]);
  if (!submission.data[0])
    return apiError("Submission was not found.", 404, "not_found");
  return json({
    submission: submission.data[0],
    flags: flags.data,
    actions: actions.data,
  });
}

const moderate = async (
  env: Env,
  moderator: Moderator,
  id: string,
  action: string,
  reason: string | null,
  notes: string | null,
  normalized: unknown = null,
): Promise<Response> => {
  const actionId = await callRpc<string>(env, "perform_moderation_action", {
    p_submission_id: id,
    p_moderator_id: moderator.userId,
    p_action: action,
    p_reason: reason,
    p_notes: notes,
    p_normalized: normalized,
  });
  return json({ message: "Moderation action recorded.", action_id: actionId });
};

const normalizedData = (value: unknown): Record<string, unknown> => {
  const body = asRecord(value);
  const normalized = asRecord(body.normalized);
  const text = (key: string, max: number, required = true) => {
    const value = normalized[key];
    if (!required && (value === null || value === undefined || value === ""))
      return null;
    if (typeof value !== "string" || !value.trim() || value.trim().length > max)
      throw new RequestError(`${key} is invalid.`, 400, "validation_failed");
    return value.trim();
  };
  const legacyCategories = Array.isArray(normalized.categories)
    ? normalized.categories
    : [];
  const primaryCategory = normalizeCategoryId(
    normalized.primary_category ?? legacyCategories[0],
  );
  const subcategories = normalized.subcategories ?? [];
  const tags = normalized.tags ?? [];
  if (
    !primaryCategory ||
    !Array.isArray(subcategories) ||
    subcategories.length > 8 ||
    subcategories.some(
      (subcategory) => !isSubcategoryFor(primaryCategory, subcategory),
    ) ||
    new Set(subcategories).size !== subcategories.length
  )
    throw new RequestError("Category selection is invalid.", 400, "validation_failed");
  if (
    !Array.isArray(tags) ||
    tags.length > 12 ||
    tags.some(
      (tag) =>
        typeof tag !== "string" ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag),
    ) ||
    new Set(tags).size !== tags.length
  )
    throw new RequestError("Tags are invalid.", 400, "validation_failed");
  return {
    title: text("title", 140),
    organization: text("organization", 100),
    categories: [primaryCategory],
    primary_category: primaryCategory,
    subcategories,
    tags,
    description: text("description", 2_000),
    eligibility: text("eligibility", 2_000),
    benefits: text("benefits", 2_000, false),
    location: text("location", 120, false),
    deadline: text("deadline", 10, false),
    source_url: safeHttpsUrl(normalized.source_url, "Source URL"),
    organization_website_url: safeHttpsUrl(
      normalized.organization_website_url,
      "Organization website",
      false,
    ),
  };
};

export async function moderationAction(
  request: Request,
  env: Env,
  id: string,
  action: string,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env);
  if (action === "undo") {
    const actionId = await callRpc<string>(env, "undo_moderation_action", {
      p_submission_id: id,
      p_moderator_id: moderator.userId,
    });
    return json({ message: "Previous action undone.", action_id: actionId });
  }
  const { data: statusRows } = await supabaseRequest<Array<{ status: string }>>(
    env,
    `/rest/v1/opportunity_submissions?id=eq.${encodeURIComponent(id)}&select=status&limit=1`,
  );
  const status = statusRows[0]?.status as SubmissionStatus | undefined;
  if (!status || !actionAllowedForStatus(status, action))
    throw new RequestError(
      "This action is not available in the submission's current queue.",
      409,
      "invalid_status_transition",
    );
  const body = asRecord(await readJson(request));
  if (action === "approve")
    return moderate(
      env,
      moderator,
      id,
      action,
      "Approved after review",
      optionalNote(body.notes),
      normalizedData(body),
    );
  if (action === "decline")
    return moderate(
      env,
      moderator,
      id,
      action,
      requiredChoice(body.reason, DECLINE_REASONS, "Reason"),
      optionalNote(body.notes),
    );
  if (action === "flag")
    return moderate(
      env,
      moderator,
      id,
      action,
      requiredChoice(body.reason, FLAG_REASONS, "Reason"),
      optionalNote(body.notes),
    );
  if (action === "unflag")
    return moderate(
      env,
      moderator,
      id,
      action,
      optionalNote(body.reason),
      optionalNote(body.notes),
    );
  if (action === "notes")
    return moderate(env, moderator, id, "note", null, optionalNote(body.notes));
  throw new RequestError("Unknown moderation action.", 404, "not_found");
}

export async function reports(request: Request, env: Env): Promise<Response> {
  await requireModerator(request, env);
  const { data } = await supabaseRequest<unknown[]>(
    env,
    "/rest/v1/listing_reports?status=in.(open,reviewing)&select=id,listing_id,reason,details,reporter_email,reporter_country_code,status,created_at&order=created_at.asc&limit=100",
  );
  return json({ count: data.length, reports: data });
}

export async function resolveReport(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env);
  const body = asRecord(await readJson(request, 8_000));
  const decision = requiredChoice(
    body.decision,
    new Set(["upheld", "dismissed"]),
    "Report decision",
  );
  const listingId = await callRpc<string>(env, "resolve_listing_report", {
    p_report_id: id,
    p_moderator_id: moderator.userId,
    p_decision: decision,
    p_notes: optionalNote(body.notes),
  });
  await caches.default.delete(listingStateCacheRequest(listingId));
  return json({
    message:
      decision === "upheld"
        ? "Report upheld and listing removed from the public index."
        : "Report dismissed; listing retained.",
    listing_id: listingId,
  });
}

const listingId = (value: string): string => {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value))
    throw new RequestError("Listing ID is invalid.", 400, "validation_failed");
  return value;
};

const listingStateCacheRequest = (id: string) =>
  new Request(`https://perkcommons.com/__listing-state-cache/${id}`);

export async function isListingRemoved(env: Env, id: string): Promise<boolean> {
  const validId = listingId(id);
  const cacheKey = listingStateCacheRequest(validId);
  const cached = await caches.default.match(cacheKey);
  if (cached) return (await cached.text()) === "removed";
  try {
    const { data } = await supabaseRequest<Array<{ listing_id: string }>>(
      env,
      `/rest/v1/listing_moderation_state?listing_id=eq.${encodeURIComponent(validId)}&removed=eq.true&select=listing_id&limit=1`,
    );
    const removed = Boolean(data[0]);
    await caches.default.put(
      cacheKey,
      new Response(removed ? "removed" : "visible", {
        headers: { "cache-control": "public, max-age=60" },
      }),
    );
    return removed;
  } catch (error) {
    // Static listings remain available during a database or migration outage.
    if (error instanceof SupabaseError) {
      console.warn(
        JSON.stringify({
          event: "listing_suppression_check_failed",
          status: error.status,
          database_code: error.databaseCode,
        }),
      );
      return false;
    }
    throw error;
  }
}

export async function publicListingState(env: Env): Promise<Response> {
  const { data } = await supabaseRequest<
    Array<{ listing_id: string; featured: boolean; removed: boolean }>
  >(
    env,
    "/rest/v1/listing_moderation_state?or=(featured.eq.true,removed.eq.true)&select=listing_id,featured,removed",
  );
  return json({ listings: data });
}

export async function featureListing(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env);
  const body = asRecord(await readJson(request, 2_000));
  if (typeof body.featured !== "boolean")
    throw new RequestError("Featured state is required.", 400, "validation_failed");
  await callRpc<void>(env, "set_listing_featured", {
    p_listing_id: listingId(id),
    p_moderator_id: moderator.userId,
    p_featured: body.featured,
  });
  return json({ message: body.featured ? "Listing featured." : "Feature removed." });
}

export async function purgeRejected(
  request: Request,
  env: Env,
  id: string | null,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env);
  const count = await callRpc<number>(env, "purge_rejected_submissions", {
    p_moderator_id: moderator.userId,
    p_submission_id: id,
  });
  return json({ message: `${count} rejected submission${count === 1 ? "" : "s"} deleted.`, count });
}

export async function moderators(
  request: Request,
  env: Env,
): Promise<Response> {
  const administrator = await requireModerator(request, env, "admin");
  if (request.method === "GET") {
    const { data } = await supabaseRequest<unknown[]>(
      env,
      "/rest/v1/moderator_profiles?select=user_id,role,active,created_at,updated_at&order=created_at.asc",
    );
    return json({ moderators: data });
  }
  assertSameOrigin(request);
  const body = asRecord(await readJson(request, 8_000));
  if (
    typeof body.user_id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.user_id,
    )
  )
    throw new RequestError("User ID is invalid.", 400, "validation_failed");
  const role = requiredChoice(
    body.role,
    new Set(["reviewer", "admin"]),
    "Role",
  );
  const active = body.active !== false;
  await supabaseRequest(
    env,
    "/rest/v1/moderator_profiles?on_conflict=user_id",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({ user_id: body.user_id, role, active }),
    },
  );
  await insertRows(env, "moderation_actions", {
    moderator_id: administrator.userId,
    action: "moderator_update",
    reason: `${role}:${active ? "active" : "inactive"}`,
    metadata: { user_id: body.user_id },
  });
  return json({ message: "Moderator profile updated." });
}

export async function createBan(request: Request, env: Env): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env, "admin");
  const body = asRecord(await readJson(request));
  const type = requiredChoice(
    body.identifier_type,
    new Set(["email", "ip", "both"]),
    "Identifier type",
  );
  const mode = requiredChoice(
    body.mode ?? "block",
    new Set(["block", "flag", "warn"]),
    "Ban mode",
  );
  const reason =
    typeof body.reason === "string"
      ? body.reason.trim().slice(0, 300)
      : "Abusive submissions";
  if (typeof body.submission_id !== "string")
    throw new RequestError("Submission is required.", 400, "validation_failed");
  const { data } = await supabaseRequest<
    Array<{
      submission_email_hash: string | null;
      submission_ip_hash: string | null;
      submitter_email: string | null;
    }>
  >(
    env,
    `/rest/v1/opportunity_submissions?id=eq.${encodeURIComponent(body.submission_id)}&select=submission_email_hash,submission_ip_hash,submitter_email&limit=1`,
  );
  const submission = data[0];
  const emailHash = submission?.submission_email_hash ?? null;
  const ipHash = submission?.submission_ip_hash ?? null;
  if (
    ((type === "email" || type === "both") && !emailHash) ||
    ((type === "ip" || type === "both") && !ipHash)
  )
    throw new RequestError(
      "This submission has no matching fingerprint.",
      400,
      "fingerprint_unavailable",
    );
  const durationHours =
    typeof body.duration_hours === "number" ? body.duration_hours : null;
  let expiresAt =
    durationHours && durationHours > 0
      ? new Date(
          Date.now() + Math.min(durationHours, 24 * 365 * 10) * 3_600_000,
        ).toISOString()
      : null;
  if (typeof body.expires_at === "string" && body.expires_at) {
    const customExpiry = new Date(body.expires_at);
    if (
      !Number.isFinite(customExpiry.getTime()) ||
      customExpiry.getTime() <= Date.now() ||
      customExpiry.getTime() > Date.now() + 10 * 365 * 24 * 3_600_000
    )
      throw new RequestError(
        "Custom expiry is invalid.",
        400,
        "validation_failed",
      );
    expiresAt = customExpiry.toISOString();
  }
  const emailHint = submission?.submitter_email
    ? maskEmail(submission.submitter_email)
    : "Email fingerprint";
  const ipHint = ipHash
    ? `Network fingerprint ...${ipHash.slice(-6)}`
    : "Network fingerprint";
  await callRpc<string[]>(env, "create_submission_bans", {
    p_submission_id: body.submission_id,
    p_moderator_id: moderator.userId,
    p_identifier_type: type,
    p_email_hash: emailHash,
    p_ip_hash: ipHash,
    p_email_hint: emailHint,
    p_ip_hint: ipHint,
    p_reason: reason,
    p_notes: optionalNote(body.notes),
    p_mode: mode,
    p_expires_at: expiresAt,
  });
  return json({ message: "Abuse control created." }, 201);
}

export async function bans(request: Request, env: Env): Promise<Response> {
  await requireModerator(request, env, "admin");
  const { data } = await supabaseRequest<unknown[]>(
    env,
    "/rest/v1/moderation_bans?active=eq.true&select=id,identifier_type,display_hint,reason,mode,created_at,expires_at&order=created_at.desc&limit=100",
  );
  return json({ bans: data });
}

export async function removeBan(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  assertSameOrigin(request);
  const moderator = await requireModerator(request, env, "admin");
  await callRpc<string>(env, "disable_moderation_ban", {
    p_ban_id: id,
    p_moderator_id: moderator.userId,
  });
  return json({ message: "Abuse control removed." });
}

export const moderationError = (error: unknown): Response => {
  if (error instanceof RequestError)
    return apiError(error.message, error.status, error.code);
  console.error(
    JSON.stringify({
      event: "moderation_api_failed",
      error: error instanceof Error ? error.name : "unknown",
    }),
  );
  return apiError(
    "The moderation service is temporarily unavailable.",
    503,
    "service_unavailable",
  );
};
