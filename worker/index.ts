export { SiteStats } from "./site-stats-object.js";
import { requireModerator } from "./lib/auth";
import { routeApiRequest } from "./lib/api-router";
import { withSecurityHeaders } from "./lib/http";
import type { Env } from "./lib/types";
import { reconcilePublicationBatches } from "./lib/publication";
import { reconcileListingRemovals } from "./lib/removal";
import { isListingRemoved } from "./routes/moderation";

const publicListingPattern = /^\/opportunities\/([a-z0-9-]+)\/?$/;

const removedListingResponse = (): Response =>
  new Response(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex"><title>Listing removed - PerkCommons</title></head><body><main><h1>Listing removed</h1><p>This opportunity was removed after moderator review.</p><p><a href="/opportunities/">Browse other opportunities</a></p></main></body></html>',
    {
      status: 410,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    },
  );

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/"))
      return withSecurityHeaders(await routeApiRequest(request, env));

    const publicListing = url.pathname.match(publicListingPattern);
    if (
      request.method === "GET" &&
      publicListing?.[1] &&
      (await isListingRemoved(env, publicListing[1]))
    )
      return withSecurityHeaders(removedListingResponse());

    if (url.pathname === "/moderate" || url.pathname.startsWith("/moderate/")) {
      try {
        await requireModerator(request, env);
      } catch {
        const login = new URL("/moderator-login/", request.url);
        login.searchParams.set("next", "/moderate/");
        return withSecurityHeaders(Response.redirect(login.toString(), 302));
      }
    }

    if (!env.ASSETS)
      return withSecurityHeaders(
        new Response("Static asset binding is unavailable.", { status: 503 }),
      );
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): Promise<void> {
    context.waitUntil(
      Promise.allSettled([
        reconcilePublicationBatches(env),
        reconcileListingRemovals(env),
      ]).then((results) => {
        results.forEach((result, index) => {
          if (result.status === "rejected")
            console.error(
              JSON.stringify({
                event:
                  index === 0
                    ? "publication_cron_failed"
                    : "removal_cron_failed",
                error:
                  result.reason instanceof Error
                    ? result.reason.name
                    : "unknown",
              }),
            );
        });
      }),
    );
  },
} satisfies ExportedHandler<Env>;
