import { expect, test } from "@playwright/test";
import { loginAsCityAdmin, loginAsSuperAdmin } from "./helpers";

test.describe("operations smoke flows", () => {
  test("city admin core operation screens render expected actions", async ({ page }) => {
    await loginAsCityAdmin(page);

    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();

    await page.goto("/sales");
    await expect(page.getByRole("heading", { name: /sales/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /\+ new sale/i })).toBeVisible();

    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: /payments/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /\+ record/i })).toBeVisible();

    await page.goto("/city-transfers");
    await expect(page.getByRole("heading", { name: /city transfers/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /send goods/i })).toBeVisible();

    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: /inventory/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /stock ledger/i })).toBeVisible();
  });

  test("city admin can open sales and transfer forms without client-side crashes", async ({ page }) => {
    await loginAsCityAdmin(page);

    await page.goto("/sales");
    await page.getByRole("button", { name: /\+ new sale/i }).click();
    await expect(page.getByRole("dialog", { name: /new sale/i })).toBeVisible();
    await expect(page.getByText(/customer \*/i)).toBeVisible();
    await expect(page.getByText(/godown \*/i)).toBeVisible();
    await expect(page.getByText(/product \*/i)).toBeVisible();

    await page.goto("/city-transfers");
    await page.getByRole("button", { name: /send goods/i }).click();
    const transferDialog = page.getByRole("dialog", { name: /send goods to another city/i });
    await expect(transferDialog).toBeVisible();
    await expect(transferDialog.getByText(/from godown/i)).toBeVisible();
    await expect(transferDialog.getByText(/product \*/i)).toBeVisible();
  });

  test("super admin supplier payment deep link opens the unified create flow", async ({ page }) => {
    await loginAsSuperAdmin(page);

    await page.goto("/supplier-payments?supplier_id=1&create=1");
    await expect(page.getByRole("heading", { name: /company payments/i })).toBeVisible();
    await expect(page.getByText(/record payment to company/i)).toBeVisible();
    await expect(page.getByText(/paid via/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /bank account/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /intermediary/i })).toBeVisible();
  });
});
