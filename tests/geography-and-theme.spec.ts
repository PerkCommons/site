import { expect, test } from "@playwright/test";

test("new submissions default worldwide and support multiple eligible countries", async ({ page }) => {
  await page.goto("/submit/");
  const scope = page.locator("#submission-global");
  await expect(scope).toHaveValue("true");
  await expect(page.locator("#submission-country-section")).toBeHidden();
  await expect(page.locator("#preview-location")).toContainText("Global");

  await scope.selectOption("false");
  await expect(page.locator("#submission-country-section")).toBeVisible();
  await page.locator("#submission-country-search").fill("Canada");
  await expect(page.locator('#submission-country-section [data-country-label*="canada"]')).toBeVisible();
  await page.locator('#submission-country-section input[value="CA"]').check();
  await page.locator("#submission-country-search").fill("United States");
  await page.locator('#submission-country-section input[value="US"]').check();
  await expect(page.locator("#preview-location")).toContainText("Canada");
  await expect(page.locator("#preview-location")).toContainText("United States");

  await page.waitForTimeout(400); // Allow debounced local draft to persist.
  await page.reload();
  await expect(scope).toHaveValue("false");
  await expect(page.locator('#submission-country-section input[value="CA"]')).toBeChecked();
  await expect(page.locator('#submission-country-section input[value="US"]')).toBeChecked();

  await scope.selectOption("true");
  await expect(page.locator("#submission-country-section")).toBeHidden();
  await expect(page.locator("#preview-location")).toContainText("Global");
});

test("UI uses the supplied semantic palette in light and dark modes", async ({ page }) => {
  await page.goto("/");
  const colors = () => page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      ["canvas", "surface", "soft", "ink", "muted", "line", "action", "link", "success", "warning", "error"]
        .map((key) => [key, css.getPropertyValue("--color-" + key).trim().toLowerCase()]),
    );
  });

  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  expect(await colors()).toMatchObject({
    canvas: "#fafbfc", surface: "#fff", soft: "#f1f4f7",
    ink: "#111827", muted: "#5b6472", line: "#dfe4ea",
    action: "#6254c7", link: "#5544c1",
    success: "#176b43", warning: "#825313", error: "#9b2c2c",
  });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  expect(await colors()).toMatchObject({
    canvas: "#0b0d12", surface: "#11151c", soft: "#171b23",
    ink: "#f8fafc", muted: "#cbd5e1", line: "#283142",
    action: "#b9adff", link: "#c6b8ff",
    success: "#65d6a1", warning: "#f4c46d", error: "#fda5a5",
  });
  // The theme intentionally animates colors; assert the settled contrast.
  await expect.poll(() => page.locator(".bg-action").first().evaluate(
    (node) => getComputedStyle(node).color,
  )).toBe("rgb(11, 13, 18)");
});
