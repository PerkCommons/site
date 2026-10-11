import { apiError, json, methodNotAllowed, RequestError } from "./http.js";
import type { Env } from "./types.js";
import { handleSiteStats } from "../routes/site-stats.js";
import {
  bans,
  canonicalListingDetail,
  createBan,
  createListingUpdate,
  createSession,
  currentModerator,
  destroySession,
  featureListing,
  moderationAction,
  markCanonicalListingInactive,
  moderationError,
  moderators,
  publicListingState,
  publishedReviewListings,
  publications,
  purgeRejected,
  queue,
  queueSummary,
  removeBan,
  removeCanonicalListing,
  reports,
  resolveReport,
  submissionDetail,
  unconfirmedListings,
  verifyCanonicalListing,
} from "../routes/moderation.js";
import {
  handlePublicError,
  handlePublicReport,
  handlePublicSubmission,
} from "../routes/public.js";

const submissionActionPattern =
  /^\/api\/moderation\/submissions\/([0-9a-f-]+)\/(approve|decline|flag|unflag|undo|notes)$/i;
const submissionDetailPattern =
  /^\/api\/moderation\/submissions\/([0-9a-f-]+)$/i;
const banPattern = /^\/api\/moderation\/bans\/([0-9a-f-]+)$/i;
const reportPattern = /^\/api\/moderation\/reports\/([0-9a-f-]+)\/resolve$/i;
const featurePattern = /^\/api\/moderation\/listings\/([a-z0-9-]+)\/feature$/;
const listingUpdatePattern =
  /^\/api\/moderation\/listings\/([a-z0-9-]+)\/updates$/;
const listingVerifyPattern =
  /^\/api\/moderation\/listings\/([a-z0-9-]+)\/verify$/;
const listingInactivePattern =
  /^\/api\/moderation\/listings\/([a-z0-9-]+)\/inactive$/;
const listingRemovePattern =
  /^\/api\/moderation\/listings\/([a-z0-9-]+)\/remove$/;
const canonicalListingPattern =
  /^\/api\/moderation\/listings\/([a-z0-9-]+)$/;

async function publicCatalogApi(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  const assets: Record<string, string> = {
    "/api/v1/opportunities": "/data/opportunities.json",
    "/api/v1/providers": "/provider-index.json",
    "/api/v1/categories": "/facet-counts.json",
  };
  const assetPath = assets[url.pathname];
  if (!assetPath) return null;
  if (request.method !== "GET") return methodNotAllowed();

  const assetUrl = new URL(assetPath, request.url);
  const response = env.ASSETS
    ? await env.ASSETS.fetch(new Request(assetUrl, { method: "GET" }))
    : await fetch(assetUrl, { method: "GET" });
  if (!response.ok)
    return apiError(
      "Catalogue asset unavailable.",
      503,
      "catalogue_unavailable",
    );

  const payload = (await response.json()) as Record<string, unknown>;
  if (url.pathname !== "/api/v1/opportunities") return json(payload);

  const all = Array.isArray(payload.records) ? payload.records : [];
  const limit = Math.min(
    100,
    Math.max(
      1,
      Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50,
    ),
  );
  let offset = 0;
  const cursor = url.searchParams.get("cursor");
  if (cursor) {
    try {
      offset = Math.max(0, Number.parseInt(atob(cursor), 10) || 0);
    } catch {
      return apiError("Cursor is invalid.", 400, "invalid_cursor");
    }
  }
  const records = all.slice(offset, offset + limit);
  const nextOffset = offset + records.length;
  return json({
    metadata: payload.metadata,
    pagination: {
      limit,
      returned: records.length,
      total: all.length,
      nextCursor:
        nextOffset < all.length ? btoa(String(nextOffset)) : null,
    },
    records,
  });
}

export async function routeApiRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (path === "/api/site-stats") return await handleSiteStats(request, env);
    const catalogResponse = await publicCatalogApi(request, env);
    if (catalogResponse) return catalogResponse;

    if (path === "/api/submissions")
      return request.method === "POST"
        ? await handlePublicSubmission(request, env)
        : methodNotAllowed();
    if (path === "/api/reports")
      return request.method === "POST"
        ? await handlePublicReport(request, env)
        : methodNotAllowed();
    if (path === "/api/listings/state")
      return request.method === "GET"
        ? await publicListingState(request, env)
        : methodNotAllowed();
    if (path === "/api/auth/session")
      return request.method === "POST"
        ? await createSession(request, env)
        : methodNotAllowed();
    if (path === "/api/auth/logout")
      return request.method === "POST"
        ? destroySession(request)
        : methodNotAllowed();
    if (path === "/api/auth/me")
      return request.method === "GET"
        ? await currentModerator(request, env)
        : methodNotAllowed();
    if (path === "/api/moderation/queue")
      return request.method === "GET"
        ? await queue(request, env)
        : methodNotAllowed();
    if (path === "/api/moderation/queue/summary")
      return request.method === "GET"
        ? await queueSummary(request, env)
        : methodNotAllowed();
    if (path === "/api/moderation/reports")
      return request.method === "GET"
        ? await reports(request, env)
        : methodNotAllowed();
    if (path === "/api/moderation/listings/unconfirmed")
      return request.method === "GET"
        ? await unconfirmedListings(request, env)
        : methodNotAllowed();
    if (path === "/api/moderation/listings/review")
      return request.method === "GET"
        ? await publishedReviewListings(request, env)
        : methodNotAllowed();
    if (path === "/api/moderation/moderators")
      return request.method === "GET" || request.method === "POST"
        ? await moderators(request, env)
        : methodNotAllowed();
    if (path === "/api/moderation/bans")
      return request.method === "GET"
        ? await bans(request, env)
        : request.method === "POST"
          ? await createBan(request, env)
          : methodNotAllowed();
    if (path === "/api/moderation/rejected")
      return request.method === "DELETE"
        ? await purgeRejected(request, env, null)
        : methodNotAllowed();
    if (path === "/api/moderation/publications")
      return request.method === "GET" || request.method === "POST"
        ? await publications(request, env)
        : methodNotAllowed();

    const featureMatch = path.match(featurePattern);
    if (featureMatch?.[1])
      return request.method === "POST"
        ? await featureListing(request, env, featureMatch[1])
        : methodNotAllowed();

    const listingVerifyMatch = path.match(listingVerifyPattern);
    if (listingVerifyMatch?.[1])
      return request.method === "POST"
        ? await verifyCanonicalListing(request, env, listingVerifyMatch[1])
        : methodNotAllowed();

    const listingInactiveMatch = path.match(listingInactivePattern);
    if (listingInactiveMatch?.[1])
      return request.method === "POST"
        ? await markCanonicalListingInactive(request, env, listingInactiveMatch[1])
        : methodNotAllowed();

    const listingRemoveMatch = path.match(listingRemovePattern);
    if (listingRemoveMatch?.[1])
      return request.method === "POST"
        ? await removeCanonicalListing(request, env, listingRemoveMatch[1])
        : methodNotAllowed();

    const listingUpdateMatch = path.match(listingUpdatePattern);
    if (listingUpdateMatch?.[1])
      return request.method === "POST"
        ? await createListingUpdate(request, env, listingUpdateMatch[1])
        : methodNotAllowed();

    const canonicalListingMatch = path.match(canonicalListingPattern);
    if (canonicalListingMatch?.[1])
      return request.method === "GET"
        ? await canonicalListingDetail(request, env, canonicalListingMatch[1])
        : methodNotAllowed();

    const detailMatch = path.match(submissionDetailPattern);
    if (detailMatch?.[1])
      return request.method === "GET"
        ? await submissionDetail(request, env, detailMatch[1])
        : request.method === "DELETE"
          ? await purgeRejected(request, env, detailMatch[1])
          : methodNotAllowed();

    const actionMatch = path.match(submissionActionPattern);
    if (actionMatch?.[1] && actionMatch[2])
      return request.method === "POST"
        ? await moderationAction(
            request,
            env,
            actionMatch[1],
            actionMatch[2].toLowerCase(),
          )
        : methodNotAllowed();

    const banMatch = path.match(banPattern);
    if (banMatch?.[1])
      return request.method === "DELETE"
        ? await removeBan(request, env, banMatch[1])
        : methodNotAllowed();

    const reportMatch = path.match(reportPattern);
    if (reportMatch?.[1])
      return request.method === "POST"
        ? await resolveReport(request, env, reportMatch[1])
        : methodNotAllowed();

    return new Response(
      JSON.stringify({
        error: { code: "not_found", message: "API route not found." },
      }),
      {
        status: 404,
        headers: {
          "content-type": "application/json",
          "cache-control": "no-store",
        },
      },
    );
  } catch (error) {
    if (
      path === "/api/auth/me" &&
      error instanceof RequestError &&
      error.status === 401
    )
      return json({ moderator: null });
    return path === "/api/submissions" || path === "/api/reports"
      ? handlePublicError(error)
      : moderationError(error);
  }
}