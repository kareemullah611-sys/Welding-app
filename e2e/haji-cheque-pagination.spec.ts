import { expect, test } from "@playwright/test";
import prisma from "../src/lib/prisma";
import { loginAsCityAdmin } from "./helpers";

async function cleanChequeFixtures() {
  const target = new URL(process.env.DATABASE_URL!);
  expect(["localhost", "127.0.0.1"]).toContain(target.hostname);
  const rows = await prisma.customer.findMany({ where: { name: "E2E cheque pagination" }, select: { id: true } });
  const ids = rows.map(row => row.id);
  await prisma.payment.deleteMany({ where: { customerId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { id: { in: ids } } });
}

test.beforeAll(cleanChequeFixtures);
test.afterAll(cleanChequeFixtures);

for (const count of [35, 235]) {
  for (const path of ["payments", "haji-transfers"]) {
    test(`${path} lists and selects all ${count} eligible cheques`, async ({ page }) => {
      const target = new URL(process.env.DATABASE_URL!);
      expect(["localhost", "127.0.0.1"]).toContain(target.hostname);
      const user = await prisma.user.findUniqueOrThrow({ where: { username: "quetta_admin" } });
      const currency = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
      const customer = await prisma.customer.create({ data: { name: "E2E cheque pagination", cityId: user.cityId! } });
      const journalsBefore = await prisma.journalEntry.count();
      const base = { cityId: user.cityId!, customerId: customer.id, currencyId: currency.id, paymentDate: new Date("2026-01-01"), detail: "E2E cheque selector only", amount: 100, paymentMethod: "cheque" as const, destination: "our_account" as const, chequeStatus: "in_hand" as const, createdBy: user.id };
      try {
        await prisma.payment.createMany({ data: Array.from({ length: count }, (_, i) => ({ ...base, chequeNumber: `CK-${String(i + 1).padStart(4, "0")}` })) });
        await prisma.payment.createMany({ data: [
          { ...base, chequeNumber: "EXCLUDED-SENT", chequeStatus: "sent_to_haji" },
          { ...base, chequeNumber: "EXCLUDED-CANCELLED", status: "cancelled" },
          { ...base, chequeNumber: "EXCLUDED-CASH", paymentMethod: "cash" },
          { ...base, chequeNumber: "EXCLUDED-DESTINATION", destination: "haji" },
        ] });
        await loginAsCityAdmin(page);
        await page.goto(`/${path}?embed=1&create=${path === "payments" ? "payment" : "1"}`);
        if (path === "payments") {
          await page.locator('select:has(option[value="haji_transfer"])').selectOption("haji_transfer");
        }
        const cacheKey = path === "payments" ? "mrf-payments-form-cache-v1" : "mrf-haji-form-cache-v1";
        await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || "null")?.data?.inHandCheques?.length, cacheKey)).toBe(count);
        await page.locator('select:has(option[value="mixed_cash_cheque"])').selectOption("cheque");
        await expect(page.getByRole("checkbox")).toHaveCount(count, { timeout: 15000 });
        await expect(page.getByText(/EXCLUDED-/)).toHaveCount(0);
        if (path === "payments") {
          await page.getByPlaceholder("Search cheques by number, customer, amount or date").fill("CK-0001");
          await expect(page.getByRole("checkbox")).toHaveCount(1);
        }
        const option = page.locator("label").filter({ hasText: "CK-0001" }).getByRole("checkbox");
        await option.check();
        await expect(option).toBeChecked();
        await option.uncheck();
        await expect(option).not.toBeChecked();
        if (path === "payments" && count === 235) {
          await page.route("**/api/v1/payments?**", async route => {
            const query = new URL(route.request().url()).searchParams;
            if (query.get("cheque_status") === "in_hand" && query.get("page") === "2") {
              await route.fulfill({ json: { success: false, error: { message: "Simulated lost page" } } });
            } else await route.continue();
          });
          await page.goto("/payments?embed=1&create=payment");
          await expect(page.getByText("Unable to load the complete cheque list. Reopen the form to retry.")).toBeVisible();
          expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).data.inHandCheques.length, cacheKey)).toBe(count);
          await page.locator('select:has(option[value="haji_transfer"])').selectOption("haji_transfer");
          await expect(page.getByText("Unable to load the complete cheque list. Reopen the form to retry.")).toBeVisible();
          await page.locator('select:has(option[value="mixed_cash_cheque"])').selectOption("cheque");
          await expect(page.getByRole("checkbox")).toHaveCount(0);
          await page.unrouteAll({ behavior: "wait" });
          await page.goto("/payments?embed=1&create=payment");
          await page.locator('select:has(option[value="haji_transfer"])').selectOption("haji_transfer");
          await page.locator('select:has(option[value="mixed_cash_cheque"])').selectOption("cheque");
          await expect(page.getByRole("checkbox")).toHaveCount(count);
        }
        expect(await prisma.payment.count({ where: { customerId: customer.id } })).toBe(count + 4);
        expect(await prisma.journalEntry.count()).toBe(journalsBefore);
      } finally {
        await page.goto("about:blank");
        await prisma.payment.deleteMany({ where: { customerId: customer.id } });
        await prisma.customer.delete({ where: { id: customer.id } });
      }
    });
  }
}
