import { expect, test } from "@playwright/test";
import { loginAsCityAdmin } from "./helpers";

test.describe("mobile smoke", () => {
  test("city admin dashboard quick forms are usable on mobile viewport", async ({ page }) => {
    await loginAsCityAdmin(page);

    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();

    await page.getByRole("button", { name: /new sale/i }).click();
    await expect(page.locator("iframe[title='New Sale form']")).toBeVisible();
    const saleFrame = page.frameLocator("iframe[title='New Sale form']");
    await expect(saleFrame.getByText(/customer \*/i)).toBeVisible();

    await page.getByRole("button", { name: /close quick form/i }).click();

    await page.getByRole("button", { name: /receive payment/i }).click();
    const paymentFrame = page.frameLocator("iframe[title='Receive Payment form']");
    await expect(paymentFrame.getByText(/how was the payment received/i)).toBeVisible();
  });
});
