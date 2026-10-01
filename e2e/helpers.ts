import { expect, Page } from "@playwright/test";

// Credentials come from the environment so CI can use its own values instead of
// the shared defaults. Defaults keep local runs working unchanged.
const superAdmin = {
  username: process.env.E2E_SUPERADMIN_USERNAME || "superadmin",
  password: process.env.E2E_SUPERADMIN_PASSWORD || "admin123",
};
const cityAdmin = {
  username: process.env.E2E_CITYADMIN_USERNAME || "quetta_admin",
  password: process.env.E2E_CITYADMIN_PASSWORD || "city123",
};

export async function loginAsSuperAdmin(page: Page) {
  await login(page, superAdmin.username, superAdmin.password);
  await expect(page).toHaveURL(/\/dashboard$/);
}

export async function loginAsCityAdmin(page: Page, username = cityAdmin.username, password = cityAdmin.password) {
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
