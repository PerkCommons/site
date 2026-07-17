import { apiError, RequestError } from "./http";
import { roleAllows } from "./moderation-policy";
import { supabaseRequest } from "./supabase";
import type { Env, Moderator, ModeratorRole } from "./types";

export const SESSION_COOKIE = "pc_moderator_session";

const cookieValue = (request: Request, name: string): string | null => {
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
};

export const sessionCookie = (token: string): string =>
  `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`;
export const clearSessionCookie = (): string =>
  `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;

export async function authenticateToken(
  env: Env,
  token: string,
): Promise<Moderator | null> {
  const userResponse = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
      authorization: `Bearer ${token}`,
    },
  });
  if (!userResponse.ok) return null;
  const user = (await userResponse.json()) as { id?: string; email?: string };
  if (!user.id) return null;
  const query = `/rest/v1/moderator_profiles?user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=role&limit=1`;
  const { data } = await supabaseRequest<Array<{ role: ModeratorRole }>>(
    env,
    query,
  );
  const role = data[0]?.role;
  return role ? { userId: user.id, email: user.email ?? "", role } : null;
}

export async function requireModerator(
  request: Request,
  env: Env,
  role?: ModeratorRole,
): Promise<Moderator> {
  const token = cookieValue(request, SESSION_COOKIE);
  const moderator = token ? await authenticateToken(env, token) : null;
  if (!moderator)
    throw new RequestError(
      "Moderator authentication is required.",
      401,
      "unauthorized",
    );
  if (role === "admin" && !roleAllows(moderator.role, "ban"))
    throw new RequestError(
      "Administrator access is required.",
      403,
      "forbidden",
    );
  return moderator;
}

export const authFailure = (error: unknown): Response | null => {
  if (
    error instanceof RequestError &&
    (error.status === 401 || error.status === 403)
  )
    return apiError(error.message, error.status, error.code);
  return null;
};
