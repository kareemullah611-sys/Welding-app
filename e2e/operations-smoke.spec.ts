import { expect, test } from "@playwright/test";
import { loginAsCityAdmin, loginAsSuperAdmin } from "./helpers";

test.describe("operations smoke flows", () => {
  test("city admin core operation screens render expected actions", async ({ page }) => {
    await loginAsCityAdmin(page);

    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();

    await page.goto("/sales");
    await expect(page.getByRole("heading", { name: /sales/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^filters$/i })).toBeVisible();

    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: /payments/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /^filters$/i })).toBeVisible();

    await page.goto("/city-transfers");
    await expect(page.getByRole("heading", { name: /city transfers/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /send goods/i })).toBeVisible();

    await page.goto("/inventory");
    await expect(page.getByRole("heading", { name: /inventory/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /stock movements/i })).toBeVisible();
  });

  test("city admin can open sales and transfer forms without client-side crashes", async ({ page }) => {
    await loginAsCityAdmin(page);

    // The sale form is opened from the dashboard quick action (the list-page
    // "+ New Sale" button was removed in 191572ca; creation goes through the
    // quickform embedded at /sales?create=1&embed=1).
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
    await page.getByText("Sale", { exact: true }).click();
    await expect(page.getByRole("dialog", { name: /sale/i })).toBeVisible();
    const saleFrame = page.frameLocator("iframe").first();
    await expect(saleFrame.getByText(/customer \*/i)).toBeVisible();
    await expect(saleFrame.getByText(/godown \*/i)).toBeVisible();
    await expect(saleFrame.getByText(/product/i).first()).toBeVisible();

    await page.goto("/city-transfers");
    await page.getByRole("button", { name: /send goods/i }).click();
    const transferDialog = page.getByRole("dialog", { name: /send goods to another city/i });
    await expect(transferDialog).toBeVisible();
    await expect(transferDialog.getByText(/source godown \*/i)).toBeVisible();
    await expect(transferDialog.getByText(/product 1/i)).toBeVisible();
  });

  test("super admin supplier payment deep link opens the unified create flow", async ({ page }) => {
    await loginAsSuperAdmin(page);

    await page.goto("/suppliers?supplier_id=1&create=1");
    await expect(page.getByRole("heading", { name: /suppliers/i })).toBeVisible();
    await expect(page.getByRole("dialog", { name: /record payment/i })).toBeVisible();
    await expect(page.getByText(/paid via/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /bank \/ cash account/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /intermediary/i })).toBeVisible();
  });
});
