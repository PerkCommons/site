const encoder = new TextEncoder();

export function normalizeIpAddress(value: string): string | null {
  const input = value.trim().toLowerCase();
  if (!input) return null;
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(input)) {
    const parts = input.split(".").map(Number);
    return parts.every((part) => part >= 0 && part <= 255)
      ? parts.join(".")
      : null;
  }

  const mapped = input.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1]) return normalizeIpAddress(mapped[1]);
  if (!/^[0-9a-f:]+$/.test(input) || (input.match(/::/g)?.length ?? 0) > 1)
    return null;

  const [left = "", right = ""] = input.split("::");
  const leftParts = left ? left.split(":") : [];
  const rightParts = right ? right.split(":") : [];
  if (!input.includes("::") && leftParts.length !== 8) return null;
  const fill = input.includes("::")
    ? 8 - leftParts.length - rightParts.length
    : 0;
  if (fill < 1 && input.includes("::")) return null;
  const parts = [...leftParts, ...Array<string>(fill).fill("0"), ...rightParts];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part)))
    return null;
  return parts.map((part) => Number.parseInt(part, 16).toString(16)).join(":");
}

export async function keyedFingerprint(
  secret: string,
  namespace: string,
  value: string | null,
): Promise<string | null> {
  if (!value) return null;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${namespace}:${value}`),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export const maskEmail = (email: string): string => {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1) || "*"}***@${domain || "unknown"}`;
};

export const normalizeUserAgent = (value: string | null): string | null =>
  value?.trim().slice(0, 512).toLowerCase() || null;
