import { expect, Page, test } from "@playwright/test";

import { loginAsSuperAdmin } from "./helpers";

async function openRowMenu(page: Page, markerText: string) {
  // A previously opened portal menu can overlay the next row's trigger (small
  // viewports) — toggle it closed first via its own uncovered trigger.
  const openTrigger = page.locator("button[aria-label='Open actions'][aria-expanded='true']");
  if ((await openTrigger.count()) > 0) await openTrigger.first().click();
  const cell = page.getByText(markerText, { exact: false }).first();
  await expect(cell).toBeVisible({ timeout: 15000 });
  const anchor = cell.locator("xpath=ancestor::*[.//button[@aria-label='Open actions']][1]");
  await anchor.getByRole("button", { name: "Open actions" }).click();
}

function permanentDeleteButton(page: Page) {
  return page.getByRole("button", { name: "Permanent Delete" });
}

test("sales: permanent delete hidden only for sales with accounting history", async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto("/sales");

  await openRowMenu(page, "E2E-H1");
  await expect(permanentDeleteButton(page)).toHaveCount(0);

  await openRowMenu(page, "E2E-P1");
  await expect(permanentDeleteButton(page)).toHaveCount(1);
});

test("payments: permanent delete hidden only for payments with accounting history", async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto("/payments");

  await openRowMenu(page, "E2E-Hist-Cust");
  await expect(permanentDeleteButton(page)).toHaveCount(0);

  await openRowMenu(page, "E2E-Plain-Pay-Cust");
  await expect(permanentDeleteButton(page)).toHaveCount(1);
});

test("customers: permanent delete hidden only for customers with accounting history", async ({ page }) => {
  await loginAsSuperAdmin(page);
  await page.goto("/customers");

  await openRowMenu(page, "E2E-Hist-Cust");
  await expect(permanentDeleteButton(page)).toHaveCount(0);

  await openRowMenu(page, "E2E-Plain-Cust");
  await expect(permanentDeleteButton(page)).toHaveCount(1);
});
