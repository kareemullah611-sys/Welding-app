import { expect, test } from "@playwright/test";
import { loginAsSuperAdmin } from "./helpers";

const loadedMarker = /No journal entries found for the selected period\.|Grand Totals/;

function countTbRequests(page: import("@playwright/test").Page): { count: () => number } {
  let n = 0;
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("/api/v1/trial-balance?") && !url.includes("/export")) n += 1;
  });
  return { count: () => n };
}

async function fillDates(page: import("@playwright/test").Page) {
  await page.locator('input[type="date"]').nth(0).fill("2026-01-01");
  await page.locator('input[type="date"]').nth(1).fill("2026-12-31");
}

test("TB: date changes apply only via Apply button, never automatically", async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto("/trial-balance");
  const counter = countTbRequests(page);

  await fillDates(page);
  await page.waitForTimeout(800);
  expect(counter.count(), "filling dates must not auto-fetch").toBe(0);

  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(loadedMarker)).toBeVisible({ timeout: 30000 });
  expect(counter.count(), "Apply must fetch exactly once").toBe(1);
});

test("TB: select changes apply only via Apply button, never automatically", async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto("/trial-balance");
  const counter = countTbRequests(page);

  await fillDates(page);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(loadedMarker)).toBeVisible({ timeout: 30000 });
  const baseline = counter.count();

  const currencySelect = page
    .locator("select")
    .filter({ has: page.locator("option", { hasText: "All Currencies" }) })
    .first();
  await currencySelect.selectOption("USD");
  await page.waitForTimeout(800);
  expect(counter.count(), "changing currency select must not auto-fetch").toBe(baseline);

  await page.getByRole("button", { name: "Apply" }).click();
  await page.waitForTimeout(500);
  expect(counter.count(), "Apply must fetch after select change").toBe(baseline + 1);
});

test("TB: search auto-applies debounced (no per-keystroke fetch)", async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto("/trial-balance");
  const counter = countTbRequests(page);

  await fillDates(page);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(loadedMarker)).toBeVisible({ timeout: 30000 });
  const baseline = counter.count();

  await page.getByPlaceholder("Search accounts...").pressSequentially("cash", { delay: 80 });
  await page.waitForTimeout(150);
  expect(counter.count(), "typing must not fetch per keystroke").toBe(baseline);

  await page.waitForTimeout(700);
  expect(counter.count(), "debounce must auto-fetch once after typing pauses").toBe(baseline + 1);
});

test("TB: failed request shows an error and clears stale data", async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto("/trial-balance");
  await fillDates(page);
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText(loadedMarker)).toBeVisible({ timeout: 30000 });

  await page.route("**/api/v1/trial-balance?*", (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ success: false, error: { message: "TB load failed" } }),
    }),
  );

  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("TB load failed")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText(loadedMarker)).toHaveCount(0, { timeout: 10000 });
});
