import type { Env } from "../lib/types.js";
import { apiError, methodNotAllowed } from "../lib/http.js";

const BROWSER_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const AUTOMATION_UA = /bot|crawler|spider|headless|lighthouse|preview|wget|curl|python-requests|facebookexternalhit|slurp|bingpreview/i;
const LISTING_PATH = /^\/opportunities\/([a-z0-9-]{2,140})\/?$/;

function responseUnavailable(): Response {
  return apiError("Activity counters are temporarily unavailable.", 503, "stats_unavailable");
}

export async function handleSiteStats(request: Request, env: Env): Promise<Response> {
  if (!env.SITE_STATS) return responseUnavailable();
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") return methodNotAllowed();
  // New EU-only object; deliberately does not migrate old pre-consent identities.
  // Local workerd does not implement jurisdictions. Production must fail closed
  // if EU restriction is unavailable: never fall back to unrestricted storage.
  const namespace = env.ENVIRONMENT === "production"
    ? env.SITE_STATS.jurisdiction("eu")
    : env.SITE_STATS;
  const stub = namespace.getByName("perkcommons-public-stats-v1");
  try {
    if (request.method === "GET") {
      const result = await stub.fetch("https://stats.internal/read");
      return new Response(result.body, { status: result.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }
    const origin = new URL(request.url).origin;
    if (request.headers.get("origin") !== origin || (request.headers.get("sec-fetch-site") && request.headers.get("sec-fetch-site") !== "same-origin"))
      return apiError("Same-origin browser requests only.", 403, "invalid_origin");
    if (!request.headers.get("content-type")?.startsWith("application/json") || Number(request.headers.get("content-length") ?? "0") > 256)
      return apiError("Invalid event format.", 400, "invalid_event");
    const referer = request.headers.get("referer");
    let pageUrl: URL;
    try { pageUrl = new URL(referer ?? ""); }
    catch { return apiError("Missing same-site page.", 403, "invalid_referer"); }
    if (pageUrl.origin !== origin) return apiError("Missing same-site page.", 403, "invalid_referer");
    const pathname = pageUrl.pathname;
    if (pathname === "/404.html" || /^\/(moderate|moderator-login|api)(\/|$)/.test(pathname))
      return apiError("Tracking is disabled on this page.", 403, "stats_disabled");
    if (request.method === "POST" && AUTOMATION_UA.test(request.headers.get("user-agent") ?? ""))
      return apiError("Automated requests are not counted.", 403, "stats_bot");
    const body = await request.text();
    if (body.length > 256) return apiError("Invalid event format.", 400, "invalid_event");
    const parsed = JSON.parse(body) as { visitorId?: unknown; open?: unknown };
    if (typeof parsed.visitorId !== "string" || !BROWSER_ID.test(parsed.visitorId))
      return apiError("Invalid visitor identifier.", 400, "invalid_visitor");
    // Rate limit by network only transiently in Cloudflare. No IP is persisted in SQLite.
    if (request.method === "POST" && env.TRACKING_RATE_LIMITER) {
      const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
      const result = await env.TRACKING_RATE_LIMITER.limit({ key: `site-stats:${ip}` });
      if (!result.success) return apiError("Too many activity updates.", 429, "rate_limited");
    }
    const month = new Date().toISOString().slice(0, 7);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.SUBMISSION_FINGERPRINT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`public-stats:${month}:${parsed.visitorId}`));
    const visitor = Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
    if (request.method === "DELETE") {
      const result = await stub.fetch("https://stats.internal/forget", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ visitor }),
      });
      return new Response(result.body, { status: result.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }
    const listing = parsed.open === true ? (pathname.match(LISTING_PATH)?.[1] ?? null) : null;
    const result = await stub.fetch("https://stats.internal/record", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ visitor, listing }),
    });
    return new Response(result.body, { status: result.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  } catch (error) {
    console.error(JSON.stringify({ event: "site_stats_unavailable", kind: error instanceof Error ? error.name : "unknown" }));
    return responseUnavailable();
  }
}
