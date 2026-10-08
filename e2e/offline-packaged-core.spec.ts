import { expect, test } from "@playwright/test";

import prisma from "../src/lib/prisma";
import { loginAsCityAdmin } from "./helpers";

const marker = `E2E Offline Customer ${Date.now()}`;

async function readOfflineQueue(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("mrf-offline", 7);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<Array<{ id: string; url: string; method: string; body: string }>>((resolve, reject) => {
      const transaction = database.transaction("queue", "readonly");
      const queued = transaction.objectStore("queue").getAll();
      queued.onsuccess = () => resolve(queued.result);
      queued.onerror = () => reject(queued.error);
    });
  });
}

async function readFullSyncStatus(page: import("@playwright/test").Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open("mrf-offline", 7);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return new Promise<string | null>((resolve, reject) => {
      const transaction = database.transaction("full_sync_meta", "readonly");
      const row = transaction.objectStore("full_sync_meta").get("sync_meta");
      row.onsuccess = () => resolve(row.result?.status ?? null);
      row.onerror = () => reject(row.error);
    });
  });
}

test.describe("packaged offline core workflow", () => {
  test.setTimeout(180_000);

  test.afterAll(async () => {
    const customers = await prisma.customer.findMany({ where: { name: marker }, select: { id: true } });
    const ids = customers.map((customer) => customer.id);
    if (ids.length > 0) {
      await prisma.syncRequest.deleteMany({ where: { module: "customers", entityId: { in: ids } } });
      await prisma.auditLog.deleteMany({ where: { entityType: "customers", entityId: { in: ids } } });
      await prisma.customer.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  });

  test("hydrates online, works offline, then synchronizes automatically", async ({ page }) => {
    test.skip(process.env.NEXT_PUBLIC_OFFLINE_ENABLED !== "true", "Requires packaged offline build flag");

    await loginAsCityAdmin(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, "platformInfo", {
        configurable: true,
        value: { runtime: "electron" },
      });
    });
    await page.reload();

    await expect.poll(() => readFullSyncStatus(page), { timeout: 120_000 }).toBe("completed");

    await page.goto("/sales?create=1");
    await expect(page.getByRole("dialog", { name: /new sale/i })).toBeVisible();
    await expect(page.getByText(/offline sales setup not ready/i)).toHaveCount(0);

    await page.goto("/payments?create=payment");
    await expect(page.getByRole("dialog", { name: /new payment/i })).toBeVisible();
    await expect(page.getByText(/payment setup is not ready offline/i)).toHaveCount(0);

    await page.route("**/api/**", async (route) => route.abort("internetdisconnected"));
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));

    await page.goto("/customers?create=1");
    const customerDialog = page.getByRole("dialog", { name: /new customer/i });
    await expect(customerDialog).toBeVisible();
    await customerDialog.getByPlaceholder("Customer name").fill(marker);
    await customerDialog.getByRole("button", { name: /^create$/i }).click();

    await expect(page.getByText(marker, { exact: true })).toBeVisible();
    await expect.poll(async () => (await readOfflineQueue(page)).filter((item) => item.url === "/api/v1/customers").length).toBe(1);
    expect(await prisma.customer.count({ where: { name: marker } })).toBe(0);

    await page.goto("/sales?create=1");
    await expect(page.getByRole("dialog", { name: /new sale/i })).toBeVisible();
    await expect(page.getByText(/offline sales setup not ready/i)).toHaveCount(0);

    await page.goto("/payments?create=payment");
    await expect(page.getByRole("dialog", { name: /new payment/i })).toBeVisible();
    await expect(page.getByText(/payment setup is not ready offline/i)).toHaveCount(0);

    await page.unroute("**/api/**");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));

    await expect.poll(async () => (await readOfflineQueue(page)).length, { timeout: 30_000 }).toBe(0);
    await expect.poll(() => prisma.customer.count({ where: { name: marker } }), { timeout: 30_000 }).toBe(1);
  });
});
