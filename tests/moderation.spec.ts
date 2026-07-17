import { expect, test, type Page } from "@playwright/test";
import type { ModerationSubmission } from "../src/lib/moderation";

const baseSubmission: ModerationSubmission = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Open Infrastructure Grant",
  organization: "Example Foundation",
  categories: ["grants"],
  description:
    "Funding for maintainers of open public infrastructure projects.\nEvidence is available on the official page.",
  eligibility: "Open-source maintainers worldwide may apply.",
  benefits: "$10,000 in unrestricted project funding.",
  location: "Global",
  deadline: "2026-12-01",
  source_url: "https://example.org/grant",
  organization_website_url: "https://example.org",
  submitter_name: "Community Contributor",
  submitter_email: "contributor@example.org",
  submitter_notes: "No affiliation with the provider.",
  status: "pending",
  risk_score: 0,
  flag_count: 0,
  submission_country_code: "PL",
  created_at: new Date(Date.now() - 18 * 60_000).toISOString(),
  updated_at: new Date().toISOString(),
  reviewed_at: null,
  published_at: null,
  last_action_at: null,
  decision_reason: null,
};

async function mockModeration(
  page: Page,
  options: {
    role?: "reviewer" | "admin";
    submission?: typeof baseSubmission;
  } = {},
) {
  const submission = options.submission ?? baseSubmission;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        moderator: {
          email: "moderator@perkcommons.org",
          role: options.role ?? "reviewer",
        },
      }),
    }),
  );
  await page.route("**/api/moderation/queue?*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        queue: "pending",
        count: 1,
        submissions: [submission],
      }),
    }),
  );
  await page.route(`**/api/moderation/submissions/${submission.id}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ submission, flags: [], actions: [] }),
    }),
  );
  await page.route("**/api/moderation/reports", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ count: 0, reports: [] }),
    }),
  );
}

test("unauthorized moderation access redirects to sign in", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "unauthorized",
          message: "Moderator authentication is required.",
        },
      }),
    }),
  );
  await page.goto("/moderate/");
  await expect(page).toHaveURL(/\/moderator-login\//);
});

test("moderator login exchanges the Supabase session for a secure Worker session", async ({
  page,
}) => {
  await page.route(
    "https://kglyikactodqfxoimgyw.supabase.co/auth/v1/token?grant_type=password",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: "test-access-token",
          refresh_token: "test-refresh-token",
          expires_in: 3600,
          token_type: "bearer",
          user: {
            id: "22222222-2222-4222-8222-222222222222",
            aud: "authenticated",
            role: "authenticated",
            email: "moderator@perkcommons.org",
          },
        }),
      }),
  );
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ moderator: { role: "reviewer" } }),
    }),
  );
  await mockModeration(page);
  await page.goto("/moderator-login/");
  await page.getByLabel("Email").fill("moderator@perkcommons.org");
  await page.getByLabel("Password").fill("correct horse battery staple");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/moderate\//);
  await expect(
    page.getByRole("heading", { name: "Open Infrastructure Grant" }),
  ).toBeVisible();
});

test("pending card renders evidence, country tooltip, links, and copy controls", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: (value: string) => {
          (window as typeof window & { copied?: string }).copied = value;
          return Promise.resolve();
        },
      },
    }),
  );
  await mockModeration(page);
  await page.goto("/moderate/");
  await expect(
    page.getByRole("heading", { name: "Open Infrastructure Grant" }),
  ).toBeVisible();
  await expect(
    page.getByText("Funding for maintainers", { exact: false }),
  ).toBeVisible();
  const country = page.getByRole("button", {
    name: "Submission country: Poland",
  });
  await country.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Poland");
  await country.focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Official source" }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  await expect(
    page.getByRole("link", { name: "Search domain" }),
  ).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("link", { name: "Check PerkCommons duplicates" }),
  ).toHaveAttribute("href", /github\.com\/PerkCommons\/data\/search/);
  await expect(
    page.getByRole("button", { name: "Abuse controls" }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Copy review brief" }).click();
  await page
    .getByRole("dialog", { name: "Copy submission" })
    .getByRole("button", { name: "Copy review brief" })
    .click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { copied?: string }).copied,
      ),
    )
    .toContain("contributor@example.org");
  await page.getByRole("button", { name: "Copy review brief" }).click();
  await page.getByRole("button", { name: "Copy redacted brief" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { copied?: string }).copied,
      ),
    )
    .not.toContain("contributor@example.org");
  await page.getByRole("button", { name: "Copy review brief" }).click();
  await page.getByRole("button", { name: "Copy publication data" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { copied?: string }).copied,
      ),
    )
    .toContain('provider: "Example Foundation"');
  await page.screenshot({
    path: testInfo.outputPath("moderation-card.png"),
    fullPage: true,
  });
});

test("unknown country uses a neutral accessible fallback", async ({ page }) => {
  await mockModeration(page, {
    submission: { ...baseSubmission, submission_country_code: null },
  });
  await page.goto("/moderate/");
  await expect(
    page.getByRole("button", { name: "Submission country: Unknown country" }),
  ).toContainText("Unknown country");
});

test("approve, decline, flag, keyboard shortcuts, and undo use authenticated APIs", async ({
  page,
}) => {
  await mockModeration(page);
  const actions: string[] = [];
  await page.route("**/api/moderation/submissions/*/*", async (route) => {
    actions.push(new URL(route.request().url()).pathname);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "Recorded" }),
    });
  });
  await page.goto("/moderate/");
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Normalize approved listing" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve and save" }).click();
  await expect
    .poll(() => actions.some((path) => path.endsWith("/approve")))
    .toBe(true);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect
    .poll(() => actions.some((path) => path.endsWith("/undo")))
    .toBe(true);
  await page.keyboard.press("f");
  await expect(
    page.getByRole("dialog", { name: "Flag for review" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("d");
  await expect(
    page.getByRole("dialog", { name: "Decline submission" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Flag", exact: true }).click();
  await page.getByRole("button", { name: "Add flag" }).click();
  await expect
    .poll(() => actions.some((path) => path.endsWith("/flag")))
    .toBe(true);
  await page.getByRole("button", { name: "Undo" }).click();
  await page.getByRole("button", { name: "Decline", exact: true }).click();
  await page
    .getByRole("button", { name: "Decline", exact: true })
    .last()
    .click();
  await expect
    .poll(() => actions.some((path) => path.endsWith("/decline")))
    .toBe(true);
});

test("swipes require deliberate horizontal movement and ignore vertical or selectable content", async ({
  page,
}) => {
  await mockModeration(page);
  await page.goto("/moderate/");
  const card = page.locator("#review-card");
  const box = await card.boundingBox();
  if (!box) throw new Error("Review card is not visible");
  const startX = box.x + 20;
  const startY = box.y + 20;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 55, startY);
  await page.mouse.up();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 160);
  await page.mouse.up();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  const description = page.locator("#submission-description");
  const descriptionBox = await description.boundingBox();
  if (descriptionBox) {
    await page.mouse.move(descriptionBox.x + 10, descriptionBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(descriptionBox.x + 160, descriptionBox.y + 10);
    await page.mouse.up();
  }
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 150, startY);
  await page.mouse.up();
  await expect(
    page.getByRole("dialog", { name: "Normalize approved listing" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 150, startY);
  await page.mouse.up();
  await expect(
    page.getByRole("dialog", { name: "Decline submission" }),
  ).toBeVisible();
});

test("mobile research sheet and reduced motion remain usable", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only control.");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockModeration(page);
  await page.goto("/moderate/");
  await page.getByRole("button", { name: "Research actions" }).click();
  await expect(
    page.getByRole("dialog", { name: "Research actions" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open official source" }),
  ).toHaveAttribute("target", "_blank");
  await expect
    .poll(() =>
      page
        .locator("#review-card")
        .evaluate((node) =>
          Number.parseFloat(getComputedStyle(node).transitionDuration),
        ),
    )
    .toBeLessThanOrEqual(0.001);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth <=
          document.documentElement.clientWidth,
      ),
    )
    .toBe(true);
});

test("ban controls are admin-only and require confirmation", async ({
  page,
}) => {
  await mockModeration(page, { role: "admin" });
  let banRequest = false;
  let moderatorUpdate = false;
  await page.route("**/api/moderation/bans", async (route) => {
    banRequest = route.request().method() === "POST";
    await route.fulfill({
      status: route.request().method() === "POST" ? 201 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        route.request().method() === "POST"
          ? { message: "Created" }
          : { bans: [] },
      ),
    });
  });
  await page.route("**/api/moderation/moderators", async (route) => {
    moderatorUpdate = route.request().method() === "POST";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        route.request().method() === "POST"
          ? { message: "Updated" }
          : { moderators: [] },
      ),
    });
  });
  await page.goto("/moderate/");
  await page.getByRole("button", { name: "Abuse controls" }).click();
  await expect(
    page.getByRole("dialog", { name: "Abuse controls" }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "Abuse controls" })
    .getByLabel("Action")
    .selectOption("email");
  await page
    .getByRole("dialog", { name: "Abuse controls" })
    .getByRole("textbox", { name: "Reason" })
    .fill("Repeated abusive submissions");
  await page.getByRole("button", { name: "Confirm abuse control" }).click();
  await expect.poll(() => banRequest).toBe(true);
  await page.getByRole("button", { name: "Manage moderators" }).click();
  await page
    .getByRole("dialog", { name: "Manage moderators" })
    .getByLabel("Auth user UUID")
    .fill("33333333-3333-4333-8333-333333333333");
  await page.getByRole("button", { name: "Save moderator profile" }).click();
  await expect.poll(() => moderatorUpdate).toBe(true);
});
