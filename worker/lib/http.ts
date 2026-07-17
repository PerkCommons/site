export const json = (
  body: unknown,
  status = 200,
  extraHeaders?: HeadersInit,
): Response => {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(body), { status, headers });
};

export const apiError = (
  message: string,
  status: number,
  code: string,
): Response => json({ error: { code, message } }, status);

export async function readJson(
  request: Request,
  maxBytes = 24_000,
): Promise<unknown> {
  const declaredSize = Number(request.headers.get("content-length") ?? "0");
  if (declaredSize > maxBytes)
    throw new RequestError("Payload is too large.", 413, "payload_too_large");
  if (
    !(request.headers.get("content-type") ?? "")
      .toLowerCase()
      .includes("application/json")
  ) {
    throw new RequestError(
      "Use an application/json request body.",
      415,
      "unsupported_media_type",
    );
  }
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBytes) {
    throw new RequestError("Payload is too large.", 413, "payload_too_large");
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new RequestError(
      "Request body is not valid JSON.",
      400,
      "invalid_json",
    );
  }
}

export class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

export const assertSameOrigin = (request: Request): void => {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    throw new RequestError(
      "Request origin was rejected.",
      403,
      "invalid_origin",
    );
  }
};

export const methodNotAllowed = (): Response =>
  apiError("Method not allowed.", 405, "method_not_allowed");
