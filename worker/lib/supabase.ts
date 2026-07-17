import type { Env } from "./types";

export class SupabaseError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
  ) {
    super(`Supabase ${operation} failed`);
  }
}

const serviceHeaders = (env: Env, extra?: HeadersInit): Headers => {
  const headers = new Headers(extra);
  headers.set("apikey", env.SUPABASE_SERVICE_ROLE_KEY);
  headers.set("authorization", `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
  return headers;
};

export async function supabaseRequest<T>(
  env: Env,
  path: string,
  init?: RequestInit,
): Promise<{ data: T; response: Response }> {
  const response = await fetch(`${env.SUPABASE_URL}${path}`, {
    ...init,
    headers: serviceHeaders(env, init?.headers),
  });
  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: "supabase_request_failed",
        operation: path.split("?")[0],
        status: response.status,
      }),
    );
    throw new SupabaseError(response.status, path.split("?")[0] ?? "request");
  }
  const data =
    response.status === 204 || response.headers.get("content-length") === "0"
      ? null
      : await response.json();
  return { data: data as T, response };
}

export async function insertRows<T>(
  env: Env,
  table: string,
  body: unknown,
): Promise<T[]> {
  const { data } = await supabaseRequest<T[]>(env, `/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  return data;
}

export async function callRpc<T>(
  env: Env,
  name: string,
  body: unknown,
): Promise<T> {
  const { data } = await supabaseRequest<T>(env, `/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return data;
}
