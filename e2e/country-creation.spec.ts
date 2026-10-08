import { test, expect } from "@playwright/test";
import prisma from "../src/lib/prisma";
import { loginAsSuperAdmin, loginAsCityAdmin } from "./helpers";

test("superadmin creates a country and uses it in city creation", async ({ page }, info) => {
  const target = new URL(process.env.DATABASE_URL!);
  expect(["localhost", "127.0.0.1"]).toContain(target.hostname);
  const name = `Browser country ${info.project.name}`;
  const code = info.project.name === "chromium" ? "ZW" : "ZV";
  const cityName = `${name} city`;
  expect(await prisma.country.count({ where: { code } })).toBe(0);
  const before = { rates: await prisma.exchangeRate.findMany(), snapshots: await prisma.sbpDailyFxSnapshot.findMany(), journals: await prisma.journalEntry.count() };
  try {
    await loginAsSuperAdmin(page);
    await page.goto("/settings");
    await page.getByRole("button", { name: "Countries", exact: true }).click();
    await page.getByRole("button", { name: "+ New Country", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Country name").fill(name);
    await dialog.getByLabel("Country code").fill(code.toLowerCase());
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
    const country = await prisma.country.findUniqueOrThrow({ where: { code } });
    expect(country.name).toBe(name);
    const usd = await prisma.currency.findUniqueOrThrow({ where: { code: "USD" } });
    const blocked = await page.request.post("/api/v1/cities", { data: { name: cityName, countryId: country.id, currencyIds: [usd.id] } });
    expect(blocked.status()).toBe(409);
    expect((await blocked.json()).error.code).toBe("FOREIGN_CARRYING_LAYER_REQUIRED");
    expect(await prisma.city.count({ where: { countryId: country.id } })).toBe(0);
    await page.reload();
    await page.getByRole("button", { name: "Countries", exact: true }).click();
    await expect(page.getByRole("cell", { name, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "+ New Country", exact: true }).click();
    await dialog.getByLabel("Country name").fill(name);
    await dialog.getByLabel("Country code").fill(code);
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("already exists");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Cities", exact: true }).click();
    await page.getByRole("button", { name: /new city/i }).click();
    await dialog.locator("input:not([type=checkbox])").fill(cityName);
    await dialog.locator("select").selectOption(String(country.id));
    await dialog.getByText("PKR", { exact: true }).click();
    await dialog.getByRole("button", { name: "Create", exact: true }).click();
    await expect(dialog).toBeHidden();
    const city = await prisma.city.findFirstOrThrow({ where: { countryId: country.id, name: cityName } });
    expect(await prisma.voucherSequence.count({ where: { cityId: city.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: "countries", entityId: country.id, action: "create" } })).toBe(1);
    expect({ rates: await prisma.exchangeRate.findMany(), snapshots: await prisma.sbpDailyFxSnapshot.findMany(), journals: await prisma.journalEntry.count() }).toEqual(before);
  } finally {
    const countries = await prisma.country.findMany({ where: { code, name } });
    const cities = await prisma.city.findMany({ where: { countryId: { in: countries.map(c => c.id) }, name: cityName } });
    const ids = cities.map(c => c.id);
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityType: "countries", entityId: { in: countries.map(c => c.id) } }, { entityType: "cities", entityId: { in: ids } }] } });
    await prisma.voucherSequence.deleteMany({ where: { cityId: { in: ids } } });
    await prisma.cityCurrency.deleteMany({ where: { cityId: { in: ids } } });
    await prisma.city.deleteMany({ where: { id: { in: ids } } });
    await prisma.country.deleteMany({ where: { id: { in: countries.map(c => c.id) } } });
  }
});

test("city admins cannot create countries through UI or API", async ({ page }) => {
  await loginAsCityAdmin(page);
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Countries", exact: true })).toHaveCount(0);
  const response = await page.request.post("/api/v1/countries", { data: { name: "Forbidden country", code: "ZZ" } });
  expect(response.status()).toBe(403);
});
