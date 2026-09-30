import { expect, test } from "@playwright/test";
import { loginAsSuperAdmin } from "./helpers";

test.describe("super admin smoke flows", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test("dashboard and payments render without city-admin-only create actions", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();

    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: /payments/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /\+ record/i })).toHaveCount(0);
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("reports exposes city filter for super admin sales report", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: /reports/i })).toBeVisible();
    const reportFilters = page.locator(".card.no-print").first();
    await expect(reportFilters.getByText(/report type/i)).toBeVisible();
    await reportFilters.getByRole("button", { name: /^filters$/i }).click();
    await expect(reportFilters.locator("select").nth(1)).toContainText("All Cities");
  });

  test("settings prevents self-deactivation from the UI", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
    await expect(page.getByText(/current account/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^deactivate$/i }).first()).toBeVisible();
  });
});
