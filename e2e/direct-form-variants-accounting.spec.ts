import { expect, test, type Page } from "@playwright/test";

import prisma from "../src/lib/prisma";
import { createSarafiAfFxSnapshot } from "../src/lib/sarafi-af-snapshot-db";
import { loginAsCityAdmin, loginAsSuperAdmin } from "./helpers";

const today = new Date().toISOString().slice(0, 10);

async function openPaymentForm(page: Page) {
  await page.getByRole("button", { name: /^payment$/i }).click();
  const frame = page.frameLocator('iframe[title="Payment form"]');
  await expect(frame.getByPlaceholder(/search customer/i)).toBeVisible();
  return frame;
}

async function selectCustomer(frame: ReturnType<Page["frameLocator"]>, customerName: string) {
  const customer = frame.getByPlaceholder(/search customer/i);
  await customer.fill(customerName);
  await frame.getByRole("button", { name: customerName, exact: true }).click();
}

async function submitPakistanPayment(input: {
  page: Page;
  customerName: string;
  method: "cheque" | "bank_transfer" | "online";
  amount: number;
  reference: string;
  note: string;
  accountLabel?: string;
}) {
  const frame = await openPaymentForm(input.page);
  await selectCustomer(frame, input.customerName);
  await frame.locator("label", { hasText: /payment method/i }).locator("..").locator("select").selectOption(input.method);
  if (input.accountLabel) {
    await frame.locator("label", { hasText: /^account/i }).locator("..").locator("select").selectOption({ label: input.accountLabel });
  }
  await frame.locator("label", { hasText: /^amount/i }).locator("..").locator("input").fill(String(input.amount));
  await frame.getByPlaceholder(input.method === "cheque" ? "e.g. 001234" : "e.g. REF-1024").fill(input.reference);
  await frame.getByPlaceholder(/^notes$/i).fill(input.note);

  const responsePromise = input.page.waitForResponse(
    (response) => response.url().endsWith("/api/v1/payments") && response.request().method() === "POST",
  );
  await frame.getByRole("button", { name: /save payment/i }).click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBe(201);
  await expect(frame.getByText(/entry recorded/i)).toBeVisible();
  const body = await response.json();
  const requestId = response.request().headers()["x-sync-request-id"];
  expect(requestId).toMatch(/^browser-/);

  const payload = response.request().postDataJSON();
  const [retryA, retryB] = await Promise.all([
    input.page.request.post("/api/v1/payments", { data: payload, headers: { "x-sync-request-id": requestId } }),
    input.page.request.post("/api/v1/payments", { data: payload, headers: { "x-sync-request-id": requestId } }),
  ]);
  expect(retryA.ok()).toBe(true);
  expect(retryB.ok()).toBe(true);
  expect(Number((await retryA.json()).data.id)).toBe(Number(body.data.id));
  expect(Number((await retryB.json()).data.id)).toBe(Number(body.data.id));

  await input.page.getByRole("button", { name: /close form/i }).click();
  return Number(body.data.id);
}

test.describe("direct-form payment variants and foreign-currency accounting", () => {
  test.setTimeout(240_000);

  test("posts cheque, bank transfer, and online receipts to their selected treasury accounts exactly once", async ({ page }) => {
    const marker = `E2E-PAY-VARIANTS-${Date.now()}`;
    const city = await prisma.city.findFirstOrThrow({ where: { name: "Quetta", country: { code: "PK" } } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "quetta_admin" } });
    const customer = await prisma.customer.create({ data: { cityId: city.id, name: `${marker}-CUSTOMER`, isActive: true } });
    const product = await prisma.product.create({ data: { name: `${marker}-PRODUCT`, isActive: true } });
    const godown = await prisma.godown.create({ data: { cityId: city.id, name: `${marker}-GODOWN`, isActive: true } });
    const lot = await prisma.lot.create({
      data: { countryId: city.countryId, lotNumber: `${marker}-LOT`, lotDate: new Date(today), status: "ongoing", createdBy: admin.id },
    });
    const distribution = await prisma.lotCityDistribution.create({
      data: { lotId: lot.id, cityId: city.id, productId: product.id, allocatedQty: 10 },
    });
    const allocation = await prisma.lotCityGodownAllocation.create({
      data: { lotCityDistributionId: distribution.id, godownId: godown.id, productId: product.id, qty: 10 },
    });
    const bank = await prisma.bankAccount.create({
      data: { cityId: city.id, bankName: `${marker}-BANK`, accountNumber: "7788", isActive: true },
    });
    const accountLabel = `${marker}-BANK-7788`;
    const paymentIds: number[] = [];

    try {
      await loginAsCityAdmin(page);
      const dashboardBeforeResponse = await page.request.get("/api/v1/dashboard");
      expect(dashboardBeforeResponse.ok()).toBe(true);
      const dashboardBefore = (await dashboardBeforeResponse.json()).data;
      const cashBefore = Number(dashboardBefore.cashPositionByCurrency?.PKR || 0);
      const financeBeforeResponse = await page.request.get("/api/v1/finance/combined?page=1&limit=1");
      expect(financeBeforeResponse.ok()).toBe(true);
      const financeBefore = await financeBeforeResponse.json();
      const runningBefore = Number(financeBefore.meta?.currentBalanceByCurrency?.PKR || 0);

      paymentIds.push(await submitPakistanPayment({
        page, customerName: customer.name, method: "cheque", amount: 100,
        reference: `${marker}-CHQ`, note: `${marker}-CHEQUE`,
      }));
      paymentIds.push(await submitPakistanPayment({
        page, customerName: customer.name, method: "bank_transfer", amount: 200,
        reference: `${marker}-BANK-REF`, note: `${marker}-BANK-PAY`, accountLabel,
      }));
      paymentIds.push(await submitPakistanPayment({
        page, customerName: customer.name, method: "online", amount: 300,
        reference: `${marker}-ONLINE-REF`, note: `${marker}-ONLINE-PAY`, accountLabel,
      }));

      expect(await prisma.payment.count({ where: { id: { in: paymentIds } } })).toBe(3);
      const payments = await prisma.payment.findMany({ where: { id: { in: paymentIds } }, orderBy: { id: "asc" } });
      expect(payments.map((row) => row.paymentMethod)).toEqual(["cheque", "bank_transfer", "online"]);
      expect(payments[0]).toMatchObject({ chequeNumber: `${marker}-CHQ`, chequeStatus: "in_hand", bankAccountId: null });
      expect(payments[1].bankAccountId).toBe(bank.id);
      expect(payments[2].bankAccountId).toBe(bank.id);

      const journals = await prisma.journalEntry.findMany({
        where: { transactionId: { in: paymentIds.map((id) => `PAY-${id}`) } },
        include: { account: true },
      });
      for (const paymentId of paymentIds) {
        const rows = journals.filter((row) => row.transactionId === `PAY-${paymentId}`);
        expect(rows).toHaveLength(2);
        expect(rows.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0)).toBe(0);
        expect(rows.some((row) => row.account.accountType === "revenue" || row.account.accountType === "expense")).toBe(false);
      }
      expect(journals.find((row) => row.transactionId === `PAY-${paymentIds[0]}` && Number(row.debit) === 100)?.account.code)
        .toBe(`1002-CHEQUE${city.id}`);
      expect(journals.find((row) => row.transactionId === `PAY-${paymentIds[1]}` && Number(row.debit) === 200)?.account.code)
        .toBe(`1050-BANK${bank.id}`);
      expect(journals.find((row) => row.transactionId === `PAY-${paymentIds[2]}` && Number(row.debit) === 300)?.account.code)
        .toBe(`1050-BANK${bank.id}`);

      const ledgerResponse = await page.request.get(`/api/v1/customers/${customer.id}`);
      expect(ledgerResponse.ok()).toBe(true);
      const ledger = (await ledgerResponse.json()).data;
      expect(ledger.balanceByCurrency.PKR).toBe(-600);
      expect(ledger.ledger.filter((row: any) => row.type === "payment")).toHaveLength(3);

      const bankLedgerResponse = await page.request.get(`/api/v1/bank-accounts/${bank.id}?view=ledger`);
      expect(bankLedgerResponse.ok()).toBe(true);
      const bankLedger = (await bankLedgerResponse.json()).data;
      expect(bankLedger.ledger.filter((row: any) => paymentIds.map((id) => `pay-${id}`).includes(String(row.key))).length).toBe(2);

      const financeAfterResponse = await page.request.get(`/api/v1/finance/combined?page=1&limit=20&q=${encodeURIComponent(marker)}`);
      expect(financeAfterResponse.ok()).toBe(true);
      const financeAfter = await financeAfterResponse.json();
      expect(Number(financeAfter.meta.currentBalanceByCurrency.PKR)).toBe(runningBefore + 600);
      const dashboardAfterResponse = await page.request.get("/api/v1/dashboard");
      expect(dashboardAfterResponse.ok()).toBe(true);
      const dashboardAfter = (await dashboardAfterResponse.json()).data;
      expect(Number(dashboardAfter.cashPositionByCurrency?.PKR || 0)).toBe(cashBefore);
    } finally {
      await prisma.syncRequest.deleteMany({ where: { module: "payments.create", entityId: { in: paymentIds.length ? paymentIds : [-1] } } });
      await prisma.auditLog.deleteMany({ where: { entityType: "payments", entityId: { in: paymentIds.length ? paymentIds : [-1] } } });
      await prisma.journalEntry.deleteMany({ where: { transactionId: { in: paymentIds.map((id) => `PAY-${id}`) } } });
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds.length ? paymentIds : [-1] } } });
      await prisma.openingInventoryValuation.deleteMany({ where: { lotId: lot.id } });
      await prisma.lotCityGodownAllocation.deleteMany({ where: { id: allocation.id } });
      await prisma.lotCityDistribution.deleteMany({ where: { id: distribution.id } });
      await prisma.lot.delete({ where: { id: lot.id } });
      await prisma.godown.delete({ where: { id: godown.id } });
      await prisma.account.deleteMany({ where: { code: { in: [`1200-C${customer.id}`, `1050-BANK${bank.id}`] }, journalEntries: { none: {} } } });
      await prisma.bankAccount.delete({ where: { id: bank.id } });
      await prisma.customer.delete({ where: { id: customer.id } });
      await prisma.product.delete({ where: { id: product.id } });
    }
  });

  test("preserves an Afghanistan AFN sale and receipt while recognizing and settling exact PKR carrying value", async ({ browser }) => {
    const marker = `E2E-AFN-DIRECT-${Date.now()}`;
    const city = await prisma.city.findFirstOrThrow({ where: { name: "Kandahar", country: { code: "AF" } } });
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "kandahar_admin" } });
    const afn = await prisma.currency.findUniqueOrThrow({ where: { code: "AFN" } });
    const customer = await prisma.customer.create({ data: { cityId: city.id, name: `${marker}-CUSTOMER`, isActive: true } });
    const product = await prisma.product.create({ data: { name: `${marker}-PRODUCT`, isActive: true } });
    const godown = await prisma.godown.create({ data: { cityId: city.id, name: `${marker}-GODOWN`, isActive: true } });
    const lot = await prisma.lot.create({
      data: { countryId: city.countryId, lotNumber: `${marker}-LOT`, lotDate: new Date(today), status: "ongoing", createdBy: admin.id },
    });
    const distribution = await prisma.lotCityDistribution.create({
      data: { lotId: lot.id, cityId: city.id, productId: product.id, allocatedQty: 10 },
    });
    const allocation = await prisma.lotCityGodownAllocation.create({
      data: { lotCityDistributionId: distribution.id, godownId: godown.id, productId: product.id, qty: 10 },
    });
    const valuation = await prisma.openingInventoryValuation.create({
      data: { lotId: lot.id, productId: product.id, quantity: 10, unitCostPkr: 2_000, totalValuePkr: 20_000, openingDate: new Date(today), createdBy: admin.id },
    });
    const snapshot = await createSarafiAfFxSnapshot({
      snapshotDate: today,
      fetchedAt: new Date(),
      sourceTimestamp: new Date(),
      rawReference: `${marker}-SARAI-SHAHZADA`,
      createdBy: admin.id,
      providerMode: "MANUAL",
      quotes: [
        { baseCurrencyCode: "USD", quoteCurrencyCode: "AFN", rawBuyRate: 70, rawSellRate: 70, rawUnit: "1" },
        { baseCurrencyCode: "PKR", quoteCurrencyCode: "AFN", rawBuyRate: 250, rawSellRate: 250, rawUnit: "1K" },
        { baseCurrencyCode: "CNY", quoteCurrencyCode: "AFN", rawBuyRate: 10, rawSellRate: 10, rawUnit: "1" },
        { baseCurrencyCode: "AED", quoteCurrencyCode: "AFN", rawBuyRate: 19, rawSellRate: 19, rawUnit: "1" },
      ],
    });
    expect(snapshot.ok).toBe(true);
    const snapshotId = snapshot.ok ? snapshot.id : 0;
    let saleId = 0;
    let paymentId = 0;
    const cityContext = await browser.newContext();
    const cityPage = await cityContext.newPage();
    const superContext = await browser.newContext();
    const superPage = await superContext.newPage();

    try {
      await loginAsCityAdmin(cityPage, "kandahar_admin", process.env.E2E_CITYADMIN_PASSWORD || process.env.CITY_ADMIN_PASSWORD || "city12345");
      await cityPage.getByRole("button", { name: /^sale$/i }).click();
      const saleFrame = cityPage.frameLocator('iframe[title="Sale form"]');
      await expect(saleFrame.getByPlaceholder(/search customer/i)).toBeVisible();
      await saleFrame.locator("select").filter({ has: saleFrame.locator("option", { hasText: godown.name }) }).selectOption(String(godown.id));
      await selectCustomer(saleFrame, customer.name);
      const productSelect = saleFrame.locator("select").filter({ has: saleFrame.locator("option", { hasText: product.name }) });
      await productSelect.selectOption(String(product.id));
      await saleFrame.locator("select").filter({ has: saleFrame.locator("option", { hasText: lot.lotNumber }) }).selectOption(String(lot.id));
      const itemRow = productSelect.locator("xpath=..");
      await itemRow.locator('input[type="number"]').nth(0).fill("1");
      await itemRow.locator('input[type="number"]').nth(1).fill("1000");
      await saleFrame.locator("label", { hasText: /^notes$/i }).locator("..").locator("input").fill(`${marker}-SALE`);
      const saleResponsePromise = cityPage.waitForResponse((response) => response.url().endsWith("/api/v1/sales") && response.request().method() === "POST");
      await saleFrame.getByRole("button", { name: /save sale/i }).click();
      const saleResponse = await saleResponsePromise;
      expect(saleResponse.status(), await saleResponse.text()).toBe(201);
      saleId = Number((await saleResponse.json()).data.id);
      await cityPage.getByRole("button", { name: /close form/i }).click();

      const sale = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, include: { currency: true } });
      expect(sale.currency.code).toBe("AFN");
      expect(Number(sale.totalAmount)).toBe(1_000);
      expect(Number(sale.fxOriginalAmount)).toBe(1_000);
      expect(Number(sale.fxSelectedRate)).toBe(4);
      expect(Number(sale.fxPkrEquivalent)).toBe(4_000);
      expect(sale.fxSnapshotId).toBe(snapshotId);
      expect(sale.fxConversionPathJson).toEqual(["AFN→PKR"]);

      const saleLayer = await prisma.foreignCurrencyCarryingLayer.findFirstOrThrow({ where: { sourceType: "sale", sourceId: saleId } });
      expect(Number(saleLayer.originalForeignAmount)).toBe(1_000);
      expect(Number(saleLayer.originalCarryingAmountPkr)).toBe(4_000);
      expect(Number(saleLayer.remainingForeignAmount)).toBe(1_000);

      const paymentFrame = await openPaymentForm(cityPage);
      await selectCustomer(paymentFrame, customer.name);
      await paymentFrame.locator("label", { hasText: /^amount/i }).locator("..").locator("input").fill("1000");
      await paymentFrame.locator("label", { hasText: /^currency/i }).locator("..").locator("select").selectOption(String(afn.id));
      await paymentFrame.getByPlaceholder(/REF-1024/i).fill(`${marker}-PAY-REF`);
      const paymentResponsePromise = cityPage.waitForResponse((response) => response.url().endsWith("/api/v1/payments") && response.request().method() === "POST");
      await paymentFrame.getByRole("button", { name: /save payment/i }).click();
      const paymentResponse = await paymentResponsePromise;
      expect(paymentResponse.status(), await paymentResponse.text()).toBe(201);
      paymentId = Number((await paymentResponse.json()).data.id);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { currency: true } });
      expect(payment.currency.code).toBe("AFN");
      expect(Number(payment.amount)).toBe(1_000);
      expect(payment.paymentMethod).toBe("cash");
      expect(payment.destination).toBe("our_account");

      const settledLayer = await prisma.foreignCurrencyCarryingLayer.findUniqueOrThrow({ where: { id: saleLayer.id } });
      expect(Number(settledLayer.remainingForeignAmount)).toBe(0);
      expect(Number(settledLayer.remainingCarryingAmountPkr)).toBe(0);
      expect(settledLayer.status).toBe("closed");
      const settlement = await prisma.foreignCurrencyMovement.findFirstOrThrow({ where: { sourceType: "customer_payment", sourceId: paymentId, movementType: "settlement" } });
      expect(Number(settlement.foreignAmount)).toBe(1_000);
      expect(Number(settlement.carryingAmountPkr)).toBe(4_000);
      expect(Number(settlement.settlementAmountPkr)).toBe(4_000);
      expect(Number(settlement.realizedFxPkr)).toBe(0);
      expect(settlement.historicalPoolDate.toISOString().slice(0, 10)).toBe(today);
      const settlementJournal = await prisma.journalEntry.findMany({ where: { transactionId: settlement.journalTransactionId! }, include: { account: true } });
      expect(settlementJournal.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0)).toBe(0);
      expect(settlementJournal.every((row) => row.currencyCode === "PKR")).toBe(true);
      expect(settlementJournal.some((row) => row.account.code === "FX-GAIN" || row.account.code === "FX-LOSS")).toBe(false);

      const customerLedgerResponse = await cityPage.request.get(`/api/v1/customers/${customer.id}`);
      expect(customerLedgerResponse.ok()).toBe(true);
      expect((await customerLedgerResponse.json()).data.balanceByCurrency.AFN).toBe(0);

      await loginAsSuperAdmin(superPage);
      const reportResponse = await superPage.request.get(`/api/v1/financial-reports?report=pnl&year=${new Date().getFullYear()}&city_id=${city.id}`);
      expect(reportResponse.ok(), await reportResponse.text()).toBe(true);
      const report = (await reportResponse.json()).data.authoritativePkr;
      expect(Number(report.totalRevenue)).toBe(4_000);
      expect(Number(report.totalCOGS)).toBe(2_000);
      expect(Number(report.grossProfit)).toBe(2_000);
      expect(Number(report.netProfit)).toBe(2_000);
    } finally {
      await cityContext.close();
      await superContext.close();
      const rootLayers = await prisma.foreignCurrencyCarryingLayer.findMany({
        where: { sourceType: "sale", sourceId: saleId || -1 },
        select: { id: true },
      });
      const childLayers = await prisma.foreignCurrencyCarryingLayer.findMany({
        where: { parentLayerId: { in: rootLayers.map((row) => row.id) } },
        select: { id: true },
      });
      const allLayerIds = [...rootLayers, ...childLayers].map((row) => row.id);
      const movements = await prisma.foreignCurrencyMovement.findMany({
        where: {
          OR: [
            { sourceType: "customer_payment", sourceId: paymentId || -1 },
            { sourceType: "sale", sourceId: saleId || -1 },
            { sourceLayerId: { in: allLayerIds } },
            { targetLayerId: { in: allLayerIds } },
          ],
        },
        select: { id: true, journalTransactionId: true },
      });
      const transactionIds = [
        `SALE-${saleId}`, `COGS-${saleId}`, `PAY-${paymentId}`,
        ...movements.map((row) => row.journalTransactionId).filter((value): value is string => Boolean(value)),
      ];
      await prisma.syncRequest.deleteMany({ where: { entityId: { in: [saleId || -1, paymentId || -1] } } });
      await prisma.auditLog.deleteMany({ where: { OR: [{ entityType: "sales", entityId: saleId || -1 }, { entityType: "payments", entityId: paymentId || -1 }] } });
      await prisma.journalEntry.deleteMany({ where: { transactionId: { in: transactionIds } } });
      await prisma.foreignCurrencyMovement.deleteMany({ where: { id: { in: movements.map((row) => row.id) } } });
      await prisma.foreignCurrencyCarryingLayer.deleteMany({ where: { id: { in: childLayers.map((row) => row.id) } } });
      await prisma.foreignCurrencyCarryingLayer.deleteMany({ where: { id: { in: rootLayers.map((row) => row.id) } } });
      await prisma.payment.deleteMany({ where: { id: paymentId || -1 } });
      await prisma.saleItem.deleteMany({ where: { saleId: saleId || -1 } });
      await prisma.sale.deleteMany({ where: { id: saleId || -1 } });
      await prisma.openingInventoryValuation.delete({ where: { id: valuation.id } });
      await prisma.lotCityGodownAllocation.delete({ where: { id: allocation.id } });
      await prisma.lotCityDistribution.delete({ where: { id: distribution.id } });
      await prisma.lot.delete({ where: { id: lot.id } });
      await prisma.godown.delete({ where: { id: godown.id } });
      await prisma.account.deleteMany({ where: { code: `1200-C${customer.id}`, journalEntries: { none: {} } } });
      await prisma.customer.delete({ where: { id: customer.id } });
      await prisma.product.delete({ where: { id: product.id } });
      await prisma.sarafiAfFxSnapshot.delete({ where: { id: snapshotId } });
    }
  });
});
