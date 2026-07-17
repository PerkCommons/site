import { expect, test } from "@playwright/test";

test("home page exposes the public index without overflow", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Opportunities should be easy to find",
  );
  await expect(
    page.getByText("GitHub Student Developer Pack", { exact: true }).first(),
  ).toBeVisible();
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

test("directory filters records and preserves a stable layout", async ({
  page,
}, testInfo) => {
  await page.goto("/opportunities/");
  await page.getByLabel("Filter listings by keyword").fill("Microsoft");
  await expect(page.getByText("1 listing", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Microsoft for Startups Founders Hub", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Notion for Education", { exact: true }),
  ).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("filtered-directory.png"),
    fullPage: true,
  });
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
}) => {
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
  await page.getByLabel("Provider *").fill("Example Foundation");
  await page
    .getByLabel("Opportunity title *")
    .fill("Open Infrastructure Grant");
  await page.getByLabel("Category *").selectOption({ index: 1 });
  await page
    .getByLabel("Official source URL *")
    .fill("https://example.org/grant");
  await page
    .getByLabel("Description *")
    .fill("Funding for maintainers of open public infrastructure projects.");
  await page
    .getByLabel("Eligibility *")
    .fill("Open-source maintainers worldwide may apply.");
  await page.getByLabel("Location (optional)").fill("Global");
  await page.getByLabel("Your name (optional)").fill("Community Contributor");
  await page
    .getByLabel("Your email (optional, never published)")
    .fill("contributor@example.org");
  await page.getByRole("checkbox").check();
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
  expect(submission?.categories).toHaveLength(1);
});

test("published listings accept reports without changing listing visibility", async ({
  page,
}) => {
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
  });
  await expect(
    page.getByRole("heading", { name: "GitHub Student Developer Pack" }),
  ).toBeVisible();
});
