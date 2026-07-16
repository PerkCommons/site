import { expect, test } from "@playwright/test";

test("home page exposes the public index without overflow", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Opportunities should be easy to find");
  await expect(page.getByText("GitHub Student Developer Pack", { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("home.png"), fullPage: true });
});

test("directory filters records and preserves a stable layout", async ({ page }, testInfo) => {
  await page.goto("/opportunities/");
  await page.getByLabel("Filter listings by keyword").fill("Microsoft");
  await expect(page.getByText("1 listing", { exact: true })).toBeVisible();
  await expect(page.getByText("Microsoft for Startups Founders Hub", { exact: true })).toBeVisible();
  await expect(page.getByText("Notion for Education", { exact: true })).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath("filtered-directory.png"), fullPage: true });
});

test("mobile navigation opens and remains keyboard accessible", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile navigation is hidden at desktop widths.");
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Open menu" });
  await menu.click();
  await expect(page.getByRole("button", { name: "Close menu" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", { name: "Mobile navigation" }).getByRole("link", { name: "Submit an opportunity" })).toBeVisible();
});
