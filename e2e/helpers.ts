import { expect, Page } from "@playwright/test";

export async function loginAsSuperAdmin(page: Page) {
  await login(page, "superadmin", "admin123");
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function loginAsCityAdmin(page: Page, username = "quetta_admin", password = "city123") {
  await login(page, username, password);
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  const inputs = page.locator("input");
  await inputs.nth(0).fill(username);
  await inputs.nth(1).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 30000 });
}
