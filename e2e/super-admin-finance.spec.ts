import { expect, test } from "@playwright/test";
import { loginAsCityAdmin, loginAsSuperAdmin } from "./helpers";

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
    // The list loads asynchronously (skeleton → rows/empty state), so wait for
    // the GET to resolve and the table to settle before deciding whether the
    // standing fixture exists — otherwise creation races the load and duplicates.
    const listLoaded = page.waitForResponse((resp) =>
      resp.url().includes("/api/v1/bank-accounts") && resp.request().method() === "GET" && resp.ok());
    await page.goto("/settings/bank-accounts");
    await expect(page.getByRole("heading", { name: /bank accounts/i })).toBeVisible();
    await listLoaded;
    const firstRowButton = page.locator("table tbody tr").first().locator("button").first();
    const emptyState = page.getByText(/no data found/i);
    await expect(firstRowButton.or(emptyState)).toBeVisible();
    if (!(await firstRowButton.isVisible())) {
      // The seed lifecycle (scripts/e2e-hard-delete-seed.ts up|down) normally
      // creates and removes this fixture; this branch keeps the spec runnable
      // standalone when the seed has not been applied.
      await page.getByRole("button", { name: /new bank account/i }).click();
      const createDialog = page.getByRole("dialog", { name: /new bank account/i });
      await expect(createDialog).toBeVisible();
      await createDialog.locator('input[placeholder="e.g. HBL, MCB, UBL"]').fill("E2E Smoke Bank");
      await createDialog.getByRole("button", { name: /^save$/i }).click();
      await expect(page.locator("table tbody tr", { hasText: "E2E Smoke Bank" }).first()).toBeVisible();
    }
    await expect(firstRowButton).toBeVisible();
    await firstRowButton.click();
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
      const dialog = page.getByRole("dialog", { name: /record a home expense/i });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(/paid from \*/i)).toBeVisible();
      await expect(dialog.getByText(/detail \*/i)).toBeVisible();
    });

  test("bank deposits list renders for super admin", async ({ page }) => {
    await page.goto("/bank-deposits");
    await expect(page.getByRole("heading", { name: /bank deposit slips/i })).toBeVisible();
    await expect(page.locator("input[type='search']")).toBeVisible();
  });
});

test.describe("withdrawals module location", () => {
  // The standalone /personal-withdrawals page and its All/Pending/Approved
  // status tabs were removed intentionally in 04e307e5 ("drop the standalone
  // personal-withdrawals page and sidebar entry; customer funds now flow
  // through the payments module"). Withdrawals now live in the payments
  // module as a record type with an Approve row action for pending items.
  test("withdrawals render as a type in the city payments module", async ({ page }) => {
    await loginAsCityAdmin(page);
    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: /payments/i })).toBeVisible();

    await page.getByRole("button", { name: /^filters$/i }).click();
    const typeSelect = page.locator("select", { has: page.locator('option[value="withdrawal"]') }).first();
    await expect(typeSelect).toBeVisible();
    await expect(typeSelect.locator('option[value="withdrawal"]')).toContainText(/withdrawal/i);
  });
});
