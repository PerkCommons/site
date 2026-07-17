import { requireModerator } from "./lib/auth";
import { methodNotAllowed } from "./lib/http";
import type { Env } from "./lib/types";
import {
  createBan,
  createSession,
  currentModerator,
  destroySession,
  moderationAction,
  moderationError,
  moderators,
  queue,
  removeBan,
  reports,
  resolveReport,
  submissionDetail,
} from "./routes/moderation";
import {
  handlePublicError,
  handlePublicReport,
  handlePublicSubmission,
} from "./routes/public";

const submissionActionPattern =
  /^\/api\/moderation\/submissions\/([0-9a-f-]+)\/(approve|decline|flag|unflag|undo|notes)$/i;
const submissionDetailPattern =
  /^\/api\/moderation\/submissions\/([0-9a-f-]+)$/i;
const banPattern = /^\/api\/moderation\/bans\/([0-9a-f-]+)$/i;
const reportPattern = /^\/api\/moderation\/reports\/([0-9a-f-]+)\/resolve$/i;

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (path === "/api/submissions")
      return request.method === "POST"
        ? handlePublicSubmission(request, env)
        : methodNotAllowed();
    if (path === "/api/reports")
      return request.method === "POST"
        ? handlePublicReport(request, env)
        : methodNotAllowed();
    if (path === "/api/auth/session")
      return request.method === "POST"
        ? createSession(request, env)
        : methodNotAllowed();
    if (path === "/api/auth/logout")
      return request.method === "POST"
        ? destroySession(request)
        : methodNotAllowed();
    if (path === "/api/auth/me")
      return request.method === "GET"
        ? currentModerator(request, env)
        : methodNotAllowed();
    if (path === "/api/moderation/queue")
      return request.method === "GET"
        ? queue(request, env)
        : methodNotAllowed();
    if (path === "/api/moderation/reports")
      return request.method === "GET"
        ? reports(request, env)
        : methodNotAllowed();
    if (path === "/api/moderation/moderators")
      return request.method === "GET" || request.method === "POST"
        ? moderators(request, env)
        : methodNotAllowed();
    if (path === "/api/moderation/bans")
      return request.method === "POST"
        ? createBan(request, env)
        : methodNotAllowed();
    const detailMatch = path.match(submissionDetailPattern);
    if (detailMatch?.[1])
      return request.method === "GET"
        ? submissionDetail(request, env, detailMatch[1])
        : methodNotAllowed();
    const actionMatch = path.match(submissionActionPattern);
    if (actionMatch?.[1] && actionMatch[2])
      return request.method === "POST"
        ? moderationAction(
            request,
            env,
            actionMatch[1],
            actionMatch[2].toLowerCase(),
          )
        : methodNotAllowed();
    const banMatch = path.match(banPattern);
    if (banMatch?.[1])
      return request.method === "DELETE"
        ? removeBan(request, env, banMatch[1])
        : methodNotAllowed();
    const reportMatch = path.match(reportPattern);
    if (reportMatch?.[1])
      return request.method === "POST"
        ? resolveReport(request, env, reportMatch[1])
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
    return path === "/api/submissions" || path === "/api/reports"
      ? handlePublicError(error)
      : moderationError(error);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return api(request, env);
    if (url.pathname === "/moderate" || url.pathname.startsWith("/moderate/")) {
      try {
        await requireModerator(request, env);
      } catch {
        const login = new URL("/moderator-login/", request.url);
        login.searchParams.set("next", "/moderate/");
        return Response.redirect(login.toString(), 302);
      }
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
