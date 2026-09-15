import { expect, test } from "@playwright/test";
import { loginAsCityAdmin } from "./helpers";

test.describe("mobile smoke", () => {
  test("city admin dashboard quick forms are usable on mobile viewport", async ({ page }) => {
    await loginAsCityAdmin(page);

    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();

    await page.getByRole("button", { name: /^sale$/i }).click();
    await expect(page.getByRole("heading", { name: /^sale$/i })).toBeVisible();
    const saleFrame = page.frameLocator('iframe[title="Sale form"]');
    await expect(saleFrame.getByText(/customer \*/i)).toBeVisible();
    await expect
      .poll(() => saleFrame.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth))
      .toBe(true);

    await page.getByRole("button", { name: /close form/i }).click();

    await page.getByRole("button", { name: /^payment$/i }).click();
    await expect(page.getByRole("heading", { name: /^payment$/i })).toBeVisible();
    const paymentFrame = page.frameLocator('iframe[title="Payment form"]');
    await expect(paymentFrame.getByText(/payment method/i)).toBeVisible();
    await expect
      .poll(() => paymentFrame.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth))
      .toBe(true);
  });
});
