import type { Env } from "./types";

export class SupabaseError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
    readonly databaseCode: string | null = null,
  ) {
    super(
      `Supabase ${operation} failed (${status}${databaseCode ? `, ${databaseCode}` : ""})`,
    );
  }
}

const safeErrorMetadata = async (
  response: Response,
): Promise<{ code: string | null; message: string | null }> => {
  const text = (await response.text()).slice(0, 4_096);
  try {
    const body = JSON.parse(text) as { code?: unknown; message?: unknown };
    return {
      code:
        typeof body.code === "string" ? body.code.slice(0, 64) : null,
      message:
        typeof body.message === "string" ? body.message.slice(0, 300) : null,
    };
  } catch {
    return { code: null, message: null };
  }
};

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
    const error = await safeErrorMetadata(response);
    console.error(
      JSON.stringify({
        event: "supabase_request_failed",
        operation: path.split("?")[0],
        status: response.status,
        databaseCode: error.code,
        message: error.message,
      }),
    );
    throw new SupabaseError(
      response.status,
      path.split("?")[0] ?? "request",
      error.code,
    );
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
