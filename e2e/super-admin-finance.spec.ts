import { expect, test } from "@playwright/test";
import { loginAsSuperAdmin } from "./helpers";

test.describe("super admin finance module smoke flows", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
  });

  test("bank accounts list renders and create modal opens with account type and currency", async ({ page }) => {
    await page.goto("/settings/bank-accounts");
    await expect(page.getByRole("heading", { name: /bank accounts/i })).toBeVisible();

    await page.getByRole("button", { name: /new bank account/i }).click();
    const dialog = page.getByRole("dialog", { name: /new bank account/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/account type \*/i)).toBeVisible();
    await expect(dialog.getByText(/currency \*/i)).toBeVisible();
    await expect(dialog.getByText(/bank name \*/i)).toBeVisible();
  });

  test("bank account ledger opens for the first account", async ({ page }) => {
    await page.goto("/settings/bank-accounts");
    const bankNameButton = page.locator("table tbody tr").first().locator("button").first();
    await expect(bankNameButton).toBeVisible();
    await bankNameButton.click();
    await expect(page.getByRole("dialog", { name: /^ledger —/i })).toBeVisible();
  });

  test("liabilities list renders and create modal opens", async ({ page }) => {
    await page.goto("/liabilities");
    await expect(page.getByRole("heading", { name: /liabilities/i })).toBeVisible();

    await page.getByRole("button", { name: /new liability/i }).click();
    const dialog = page.getByRole("dialog", { name: /new liability/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/name \*/i)).toBeVisible();
  });

  test("investors list renders and create modal opens", async ({ page }) => {
    await page.goto("/investors");
    await expect(page.getByRole("heading", { name: /investors/i })).toBeVisible();

    await page.getByRole("button", { name: /new investor/i }).click();
    await expect(page.getByText(/name \*/i)).toBeVisible();
    await expect(page.getByText(/start date \*/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /create investor/i })).toBeVisible();
  });

  test("home expenses list renders and record modal opens", async ({ page }) => {
    await page.goto("/super-admin-personal-expenses");
    await expect(page.getByRole("heading", { name: /home expenses/i })).toBeVisible();
    await expect(page.getByText(/only for home spending/i)).toBeVisible();

    await page.getByRole("button", { name: /new expense/i }).click();
    const dialog = page.getByRole("dialog", { name: /record home expense/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/bank account \*/i)).toBeVisible();
    await expect(dialog.getByText(/detail \*/i)).toBeVisible();
  });

  test("withdrawals list renders with approval status filters", async ({ page }) => {
    await page.goto("/personal-withdrawals");
    await expect(page.getByRole("heading", { name: /personal withdrawals/i })).toBeVisible();

    await expect(page.getByRole("button", { name: /^all \(/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^pending \(/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^approved \(/i })).toBeVisible();
  });

  test("bank deposits list renders for super admin", async ({ page }) => {
    await page.goto("/bank-deposits");
    await expect(page.getByRole("heading", { name: /bank deposit slips/i })).toBeVisible();
    await expect(page.locator("input[type='search']")).toBeVisible();
  });
});
