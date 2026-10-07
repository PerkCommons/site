import { expect, test } from "@playwright/test";

const hostedBaseUrl = process.env.PERKCOMMONS_HOSTED_BASE_URL;
const expectedHeaders = [
  "x-content-type-options",
  "referrer-policy",
  "permissions-policy",
  "content-security-policy",
  "content-security-policy-report-only",
] as const;

test("deployed homepage and 404 responses expose the reviewed security headers", async ({ request }) => {
  test.skip(!hostedBaseUrl, "Set PERKCOMMONS_HOSTED_BASE_URL to verify deployed production headers.");

  for (const [path, status] of [
    ["/", 200],
    ["/__perkcommons_header_probe_missing__", 404],
  ] as const) {
    const response = await request.get(new URL(path, hostedBaseUrl).toString());
    expect(response.status(), `${path} status`).toBe(status);
    const headers = response.headers();
    for (const name of expectedHeaders) {
      expect(headers[name], `${path} ${name}`).toBeTruthy();
    }
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["content-security-policy"]).toContain("base-uri 'self'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("form-action 'self'");
  }
});
