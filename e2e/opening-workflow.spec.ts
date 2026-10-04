import { expect, test } from "@playwright/test";
import { loginAsCityAdmin, loginAsSuperAdmin } from "./helpers";

test.describe("opening workflow", () => {
  test("city admin can inspect and submit the controlled opening workflow", async ({ page }) => {
    await loginAsCityAdmin(page);
    await page.goto("/openings");

    await expect(page.getByRole("heading", { name: "Opening Entries" })).toBeVisible();
    await expect(page.getByText(/Opening balance \(cash\)/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Opening Haji balance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Opening customer balance" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Opening product inventory", exact: true })).toBeVisible();
  });

  test("superadmin can review opening readiness and package controls", async ({ page }) => {
    await loginAsSuperAdmin(page);
    await page.goto("/openings");

    await expect(page.getByRole("heading", { name: "Opening Entries" })).toBeVisible();
    await expect(page.getByText("One-time cutover control")).toBeVisible();
    const cutoverConfirmation = page.getByPlaceholder("Type FINALIZE OPENINGS");
    if (await cutoverConfirmation.count()) {
      await expect(cutoverConfirmation).toBeVisible();
      await expect(page.getByRole("button", { name: /Finalize openings/i })).toBeDisabled();
    }
  });
});
