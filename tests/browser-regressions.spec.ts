import { expect, test, type Page } from "@playwright/test";

const representativeRoutes = [
  { path: "/", status: 200 },
  { path: "/opportunities/", status: 200 },
  { path: "/opportunities/microsoft-for-startups-founders-hub/", status: 200 },
  { path: "/categories/startup-benefits/", status: 200 },
  { path: "/about/", status: 200 },
  { path: "/trust/", status: 200 },
  { path: "/data-quality/", status: 200 },
  { path: "/privacy/", status: 200 },
  { path: "/__perkcommons_runtime_probe_missing__", status: 404 },
] as const;

const installRuntimeCollectors = (page: Page) => {
  const errors = {
    console: [] as Array<{ text: string; url: string }>,
    page: [] as string[],
    requests: [] as string[],
  };
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.console.push({
        text: message.text(),
        url: message.location().url,
      });
    }
  });
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("requestfailed", (request) => {
    errors.requests.push(`${request.method()} ${request.url()} - ${request.failure()?.errorText ?? "failed"}`);
  });
  return errors;
};

const mockStaticPreviewWorkerDependencies = async (page: Page) => {
  // Astro preview serves only the static build. These read-only public probes
  // are provided by the separate Worker in hosted environments, so the local
  // runtime sweep uses neutral responses without hiding arbitrary HTTP errors.
  await page.route("**/api/listings/state?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ listings: [] }),
    }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ moderator: null }),
    }),
  );
  await page.route("**/api/site-stats", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ month: "2026-10", monthlyBrowsers: 0, onlineNow: 0, listingOpens: 0 }),
    }),
  );
};

const isExpectedDocument404 = (
  error: { text: string; url: string },
  route: (typeof representativeRoutes)[number],
) => {
  if (route.status !== 404) return false;
  if (error.text !== "Failed to load resource: the server responded with a status of 404 (Not Found)") return false;
  try {
    return new URL(error.url).pathname === route.path;
  } catch {
    return false;
  }
};

test("representative routes have no console, page, or resource-load regressions", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Runtime regression sweep runs once in desktop Chromium.");
  await mockStaticPreviewWorkerDependencies(page);
  const errors = installRuntimeCollectors(page);

  for (const route of representativeRoutes) {
    errors.console.length = 0;
    errors.page.length = 0;
    errors.requests.length = 0;

    const response = await page.goto(route.path, { waitUntil: "networkidle" });
    expect(response?.status(), `${route.path} status`).toBe(route.status);
    expect(
      errors.console.filter((error) => !isExpectedDocument404(error, route)),
      `${route.path} console errors`,
    ).toEqual([]);
    expect(errors.page, `${route.path} page errors`).toEqual([]);
    expect(errors.requests, `${route.path} failed requests`).toEqual([]);
  }
});

test("representative responses contain useful HTML before browser JavaScript runs", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Source HTML audit runs once in desktop Chromium.");

  for (const route of representativeRoutes) {
    const response = await request.get(route.path);
    expect(response.status(), `${route.path} status`).toBe(route.status);
    const html = await response.text();

    expect(html, `${route.path} main`).toMatch(/<main(?:\s|>)/i);
    expect(html, `${route.path} h1`).toMatch(/<h1(?:\s|>)/i);
    expect(html, `${route.path} title`).toMatch(/<title>[^<]+<\/title>/i);

    const description = html.match(/<meta[^>]+name=["']description["'][^>]*>/i)?.[0] ?? "";
    expect(description, `${route.path} meta description`).toMatch(/content=["'][^"']+["']/i);

    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]*>/i)?.[0] ?? "";
    expect(canonical, `${route.path} canonical`).toMatch(/href=["']https?:\/\/[^"']+["']/i);
  }
});