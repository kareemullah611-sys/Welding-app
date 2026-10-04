import { expect, test } from "@playwright/test";
import prisma from "../src/lib/prisma";
import { loginAsCityAdmin, loginAsSuperAdmin } from "./helpers";

test("inter-godown transfer reversal restores stock without deleting history", async ({ page }) => {
  await loginAsCityAdmin(page);
  const marker = `e2e-gd-reverse-${Date.now()}`;
  const city = await prisma.city.findFirstOrThrow({ where: { name: "Quetta" } });
  const admin = await prisma.user.findUniqueOrThrow({ where: { username: "quetta_admin" } });
  const product = await prisma.product.create({ data: { name: `${marker}-product`, isActive: true } });
  const from = await prisma.godown.create({ data: { cityId: city.id, name: `${marker}-from`, isActive: true } });
  const to = await prisma.godown.create({ data: { cityId: city.id, name: `${marker}-to`, isActive: true } });
  const lot = await prisma.lot.create({ data: { countryId: city.countryId, lotNumber: marker, lotDate: new Date(), status: "ongoing", createdBy: admin.id } });
  const distribution = await prisma.lotCityDistribution.create({ data: { lotId: lot.id, cityId: city.id, productId: product.id, allocatedQty: 10 } });
  await prisma.lotCityGodownAllocation.create({ data: { lotCityDistributionId: distribution.id, godownId: from.id, productId: product.id, qty: 10 } });
  let originalId = 0;
  try {
    const created = await page.request.post("/api/v1/godowns/transfers", { data: { fromGodownId: from.id, toGodownId: to.id, productId: product.id, lotId: lot.id, qty: 4, notes: marker } });
    expect(created.status()).toBe(201);
    originalId = (await created.json()).data.id;
    await page.goto("/inventory");
    await page.getByRole("button", { name: "Inter-Godown" }).click();
    const transferDialog = page.getByRole("dialog", { name: "Inter-Godown Transfer" });
    await expect(transferDialog.getByText(`${marker}-product · 4`, { exact: true })).toBeVisible();
    page.once("dialog", async (dialog) => dialog.accept("E2E controlled reversal"));
    await transferDialog.getByRole("button", { name: "Reverse" }).click();
    await expect(transferDialog.getByText("Reversed")).toBeVisible();
    const rows = await prisma.godownTransfer.findMany({ where: { OR: [{ id: originalId }, { notes: { startsWith: `Reversal of transfer #${originalId}` } }] } });
    expect(rows).toHaveLength(2);
    expect(rows.reduce((net, row) => net + (row.fromGodownId === from.id ? -Number(row.qty) : Number(row.qty)), 0)).toBe(0);
    const duplicate = await page.request.post(`/api/v1/godowns/transfers/${originalId}/reverse`, { data: { reason: "duplicate" } });
    expect(duplicate.status()).toBe(409);
  } finally {
    await prisma.auditLog.deleteMany({ where: { entityType: "godown_transfers", entityId: originalId || -1 } });
    await prisma.godownTransfer.deleteMany({ where: { OR: [{ id: originalId || -1 }, { notes: { startsWith: `Reversal of transfer #${originalId}` } }] } });
    await prisma.lotCityGodownAllocation.deleteMany({ where: { lotCityDistributionId: distribution.id } });
    await prisma.lotCityDistribution.delete({ where: { id: distribution.id } });
    await prisma.lot.delete({ where: { id: lot.id } });
    await prisma.godown.deleteMany({ where: { id: { in: [from.id, to.id] } } });
    await prisma.product.delete({ where: { id: product.id } });
  }
});

test("superadmin liability create payment reversal edit and deactivation reconcile", async ({ page }) => {
  await loginAsSuperAdmin(page);
  const marker = `E2E Liability ${Date.now()}`;
  const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
  const city = await prisma.city.findFirstOrThrow({ where: { name: "Quetta" } });
  const counter = await prisma.account.create({
    data: { code: `E2EL${Date.now()}`.slice(0, 20), name: `${marker} Counter`, accountType: "expense" },
  });
  let accountId = 0;
  let controlAccountId = 0;
  try {
    const accountRes = await page.request.post("/api/v1/super-admin-liabilities", { data: { name: marker, partyType: "creditor" } });
    expect(accountRes.status()).toBe(201);
    accountId = (await accountRes.json()).data.id;
    controlAccountId = (await prisma.superAdminLiabilityAccount.findUniqueOrThrow({ where: { id: accountId } })).controlAccountId;
    const incurred = await page.request.post(`/api/v1/super-admin-liabilities/${accountId}/entries`, { data: { entryType: "liability_incurred", entryDate: "2026-10-03", currencyId: pkr.id, amount: 100, counterAccountId: counter.id } });
    expect(incurred.status()).toBe(201);
    const incurredId = (await incurred.json()).data.id;
    const payment = await page.request.post(`/api/v1/super-admin-liabilities/${accountId}/entries`, { data: { entryType: "payment", entryDate: "2026-10-03", currencyId: pkr.id, amount: 40, sourceType: "city_cash", cityId: city.id } });
    expect(payment.status()).toBe(201);
    const paymentId = (await payment.json()).data.id;
    let ledger = await (await page.request.get(`/api/v1/super-admin-liabilities/${accountId}/entries`)).json();
    expect(ledger.data.balancePkr).toBe(60);
    expect((await page.request.post(`/api/v1/super-admin-liability-entries/${paymentId}/reverse`, { data: { reason: "E2E payment reversal" } })).ok()).toBeTruthy();
    ledger = await (await page.request.get(`/api/v1/super-admin-liabilities/${accountId}/entries`)).json();
    expect(ledger.data.balancePkr).toBe(100);
    expect((await page.request.post(`/api/v1/super-admin-liability-entries/${incurredId}/reverse`, { data: { reason: "E2E liability reversal" } })).ok()).toBeTruthy();
    await page.goto("/super-admin-liabilities");
    let accountRow = page.getByRole("row").filter({ hasText: marker });
    await accountRow.getByRole("button", { name: "Open actions" }).click();
    await page.getByRole("button", { name: "Edit account" }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit lender or creditor" });
    await editDialog.getByRole("textbox").first().fill(`${marker} Updated`);
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    accountRow = page.getByRole("row").filter({ hasText: `${marker} Updated` });
    await expect(accountRow).toBeVisible();
    await accountRow.getByRole("button", { name: "Open actions" }).click();
    page.once("dialog", async (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Deactivate account" }).click();
    await expect(accountRow).toContainText("inactive");
    const account = await prisma.superAdminLiabilityAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.isActive).toBe(false);
    const journals = await prisma.journalEntry.findMany({ where: { entityType: "super_admin_liability_entry", entityId: { in: [incurredId, paymentId] } } });
    expect(journals.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0)).toBe(0);
  } finally {
    if (accountId) {
      const entries = await prisma.superAdminLiabilityEntry.findMany({ where: { accountId }, select: { id: true } });
      const ids = entries.map((entry) => entry.id);
      await prisma.journalEntry.deleteMany({ where: { OR: [{ entityId: { in: ids }, entityType: "super_admin_liability_entry" }, { transactionId: { in: ids.flatMap((id) => [`SALIAB-${id}`, `REV-SALIAB-${id}`]) } }] } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ entityType: "super_admin_liability_entries", entityId: { in: ids } }, { entityType: "super_admin_liability_accounts", entityId: accountId }] } });
      await prisma.superAdminLiabilityEntry.deleteMany({ where: { accountId } });
      await prisma.superAdminLiabilityAccount.delete({ where: { id: accountId } });
      if (controlAccountId) await prisma.account.delete({ where: { id: controlAccountId } });
    }
    await prisma.account.delete({ where: { id: counter.id } });
  }
});
