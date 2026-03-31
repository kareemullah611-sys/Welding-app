import { expect, Page } from "@playwright/test";

export async function loginAsSuperAdmin(page: Page) {
  await page.goto("/login");
  const inputs = page.locator("input");
  await inputs.nth(0).fill("superadmin");
  await inputs.nth(1).fill("admin123");
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 30000 });
  await expect(page).toHaveURL(/\/dashboard$/);
}
