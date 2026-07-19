import { expect, test, type Page, type Route } from "@playwright/test";

async function mockTurnstile(page: Page) {
  await page.route(
    "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit",
    async (route: Route) => {
      await route.fulfill({
        contentType: "text/javascript",
        body: `window.turnstile={render:function(_container,options){window.__turnstileOptions=options;return "test-widget"},execute:function(){queueMicrotask(function(){window.__turnstileOptions.callback("test-turnstile-token")})},reset:function(){}};`,
      });
    },
  );
}

test("home page exposes the public index without overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Opportunities should be easy to find",
  );
  await expect(page.getByRole("link", { name: "Browse the index" })).toBeVisible();
  await expect(page.locator("dd").first()).toHaveText(/^\d[\d,]*$/);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("home.png"),
    fullPage: true,
  });
});

test("footer exposes the public contact channels", async ({ page }) => {
  await page.goto("/");
  const footer = page.locator("footer");
  const contacts = [
    ["General", "mailto:hello@perkcommons.com"],
    ["Support", "mailto:support@perkcommons.com"],
    ["Security", "mailto:security@perkcommons.com"],
    ["Privacy", "mailto:privacy@perkcommons.com"],
    ["Press", "mailto:press@perkcommons.com"],
  ] as const;

  for (const [name, href] of contacts) {
    await expect(footer.getByRole("link", { name, exact: true })).toHaveAttribute(
      "href",
      href,
    );
  }
});

test("directory filters records and preserves a stable layout", async ({
  page,
}, testInfo) => {
  await page.goto("/opportunities/?category=startup-benefits");
  await expect(page.getByLabel("Category")).toHaveValue("startup-benefits");
  await page.getByRole("searchbox", { name: "Search" }).fill("Microsoft");
  await expect(page.getByText("1 opportunity", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/category=startup-benefits/);
  await expect(page).toHaveURL(/q=microsoft/);
  await expect(
    page.locator('a[href="/opportunities/microsoft-for-startups-founders-hub/"]').first(),
  ).toBeVisible();
  await expect(
    page.getByText("Notion for Education", { exact: true }),
  ).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("filtered-directory.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.locator("#count")).toHaveText(/^\d+ opportunities$/);
  await expect(page).toHaveURL(/\/opportunities\/$/);
});

test("category pages expose counts, stable routes, and indexed taxonomy metadata", async ({
  page,
}) => {
  await page.goto("/categories/");
  await expect(page.getByRole("heading", { name: "Opportunity categories" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Browse opportunities/ }).first()).toBeVisible();
  await page.goto("/categories/startup-benefits/");
  await expect(page.getByRole("heading", { name: "Startup Benefits" })).toBeVisible();
  await expect(
    page.locator('a[href="/opportunities/microsoft-for-startups-founders-hub/"]').first(),
  ).toBeVisible();
  await expect(page.getByText("Notion for Education", { exact: true })).toHaveCount(0);
  await page.goto("/opportunities/microsoft-for-startups-founders-hub/");
  await expect(page.locator('[data-pagefind-filter="category"]')).toHaveText("Startup Benefits");
  await expect(page.locator('[data-pagefind-meta="subcategory"]')).toContainText(["Cloud credits", "Developer tooling"]);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("mobile navigation opens and remains keyboard accessible", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "Mobile navigation is hidden at desktop widths.",
  );
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Open menu" });
  await menu.click();
  await expect(
    page.getByRole("button", { name: "Close menu" }),
  ).toHaveAttribute("aria-expanded", "true");
  await expect(
    page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Submit an opportunity" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Mobile navigation" })
      .getByRole("link", { name: "Moderator sign in" }),
  ).toHaveAttribute("href", "/moderator-login/");
});

test("primary navigation exposes moderator sign in", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Desktop navigation is hidden at mobile widths.",
  );
  await page.goto("/");
  const signIn = page
    .getByRole("navigation", { name: "Primary navigation" })
    .getByRole("link", { name: "Moderator sign in" });
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute("href", "/moderator-login/");
  const bounds = await signIn.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
});

test("theme switch follows the system, persists, and stays offset", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");

  const root = page.locator("html");
  const toggle = page.getByRole("button", { name: "Switch to light mode" });
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");

  const bounds = await toggle.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(bounds!.width).toBeGreaterThanOrEqual(44);
  expect(bounds!.height).toBeGreaterThanOrEqual(44);
  expect(bounds!.x).toBeGreaterThanOrEqual(12);
  expect(viewport!.height - bounds!.y - bounds!.height).toBeGreaterThanOrEqual(
    12,
  );
  expect(
    await toggle.evaluate((element) =>
      getComputedStyle(element)
        .transitionDuration.split(",")
        .some((duration) => Number.parseFloat(duration) >= 0.1),
    ),
  ).toBe(true);

  await toggle.click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "Switch to dark mode" }),
  ).toHaveAttribute("aria-pressed", "false");

  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
});

test("theme changes respect reduced motion", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Switch to dark mode" });
  expect(
    await toggle.evaluate((element) =>
      getComputedStyle(element)
        .transitionDuration.split(",")
        .every((duration) => Number.parseFloat(duration) <= 0.01),
    ),
  ).toBe(true);
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("submission form sends a reviewable opportunity through the Worker", async ({
  page,
}, testInfo) => {
  await mockTurnstile(page);
  let submission: Record<string, unknown> | undefined;

  await page.route("**/api/submissions", async (route) => {
    submission = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ message: "Submitted for review." }),
    });
  });

  await page.goto("/submit/");
  const turnstileEnabled =
    (await page.locator("#submission-turnstile").count()) > 0;
  await page.getByLabel("Provider *").fill("Example Foundation");
  await page
    .getByLabel("Opportunity title *")
    .fill("Open Infrastructure Grant");
  await page.getByLabel("Primary category *").selectOption("funding");
  await page.getByRole("checkbox", { name: "Grants", exact: true }).check();
  await page.getByLabel("Tags (optional)").fill("open-source, remote");
  await page
    .getByLabel("Official source URL *")
    .fill("https://example.org/grant");
  await page
    .getByLabel("Description *")
    .fill("Funding for maintainers of open public infrastructure projects.");
  await page
    .getByLabel("Eligibility *")
    .fill("Open-source maintainers worldwide may apply.");
  await page
    .getByLabel("Benefits (optional)")
    .fill("Up to $10,000 in project funding.");
  await page.getByLabel("Location (optional)").fill("Global");
  await page.getByLabel("Deadline (optional)").fill("2026-12-01");
  await page.getByLabel("Your name (optional)").fill("Community Contributor");
  await page
    .getByLabel("Your email (optional, never published)")
    .fill("contributor@example.org");

  const preview = page.getByRole("article", {
    name: "Opportunity submission preview",
  });
  await expect(preview.getByText("Example Foundation", { exact: true })).toBeVisible();
  await expect(preview.getByRole("heading", { name: "Open Infrastructure Grant" })).toBeVisible();
  await expect(preview.getByText("Funding", { exact: true })).toBeVisible();
  await expect(preview.getByText("Grants", { exact: true })).toBeVisible();
  await expect(preview.getByText("#open-source", { exact: true })).toBeVisible();
  await expect(preview.getByText("example.org", { exact: true })).toBeVisible();
  await expect(preview.getByText("Dec 1, 2026", { exact: true })).toBeVisible();
  await expect(preview).not.toContainText("contributor@example.org");
  await page.screenshot({
    path: testInfo.outputPath("submission-live-preview.png"),
    fullPage: true,
  });

  await page.getByRole("checkbox", { name: /I have disclosed my/ }).check();
  await page.getByRole("button", { name: "Send for review" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "Submitted. A moderator will review the evidence before publication.",
  );
  expect(submission).toMatchObject({
    organization: "Example Foundation",
    name: "Open Infrastructure Grant",
    source_url: "https://example.org/grant",
    location: "Global",
    submitter_email: "contributor@example.org",
  });
  expect(submission).toMatchObject({
    primary_category: "funding",
    subcategories: ["grants"],
    tags: ["open-source", "remote"],
    turnstile_token: turnstileEnabled ? "test-turnstile-token" : null,
  });
  await expect(preview.getByRole("heading", { name: "Opportunity title" })).toBeVisible();
  await expect(preview.getByText("Provider name", { exact: true })).toBeVisible();
});

test("submission preview is safe, responsive, and visible on mobile", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "Mobile ordering is specific to the narrow layout.",
  );
  await page.goto("/submit/");
  const preview = page.getByRole("article", {
    name: "Opportunity submission preview",
  });
  await page
    .getByLabel("Opportunity title *")
    .fill('<img src=x onerror="document.body.dataset.injected=1"> Research Grant');
  await expect(preview).toContainText('<img src=x onerror="document.body.dataset.injected=1"> Research Grant');
  await expect(preview.locator("img")).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveAttribute("data-injected", "1");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
  const previewBounds = await preview.boundingBox();
  const formBounds = await page.locator("#submission-form").boundingBox();
  expect(previewBounds).not.toBeNull();
  expect(formBounds).not.toBeNull();
  expect(previewBounds!.y).toBeLessThan(formBounds!.y);
  await page.screenshot({
    path: testInfo.outputPath("submission-live-preview-mobile.png"),
    fullPage: true,
  });
});

test("published listings accept reports without changing listing visibility", async ({
  page,
}) => {
  await mockTurnstile(page);
  let report: Record<string, unknown> | undefined;
  await page.route("**/api/reports", async (route) => {
    report = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ message: "Submitted for review." }),
    });
  });
  await page.goto("/opportunities/github-student-developer-pack/");
  const turnstileEnabled =
    (await page.locator("#report-turnstile").count()) > 0;
  await page.getByRole("button", { name: "Report this listing" }).click();
  await page.getByLabel("Reason").selectOption("Broken link");
  await page
    .getByLabel("Details (optional)")
    .fill("The application link currently returns an error.");
  await page.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Report received for moderator review.",
  );
  expect(report).toMatchObject({
    listing_id: "github-student-developer-pack",
    reason: "Broken link",
    turnstile_token: turnstileEnabled ? "test-turnstile-token" : null,
  });
  await expect(
    page.getByRole("heading", { name: "GitHub Student Developer Pack" }),
  ).toBeVisible();
});
