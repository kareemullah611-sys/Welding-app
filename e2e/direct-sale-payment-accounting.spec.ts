import { expect, test } from "@playwright/test";

import prisma from "../src/lib/prisma";
import { loginAsCityAdmin } from "./helpers";

test.describe("direct dashboard Sale and Payment accounting", () => {
  test.setTimeout(180_000);

  test("posts one sale and one payment through the direct forms and reconciles end to end", async ({ page }) => {
    const marker = `E2E-DIRECT-${Date.now()}`;
    const customerName = `${marker}-CUSTOMER`;
    const productName = `${marker}-PRODUCT`;
    const godownName = `${marker}-GODOWN`;
    const lotNumber = `${marker}-LOT`;
    const saleNote = `${marker}-SALE`;
    const paymentNote = `${marker}-PAYMENT`;
    const paymentReference = `${marker}-REF`;
    const today = new Date().toISOString().slice(0, 10);

    const city = await prisma.city.findFirstOrThrow({
      where: { name: "Quetta", country: { code: "PK" } },
    });
    const admin = await prisma.user.findUniqueOrThrow({ where: { username: "quetta_admin" } });
    const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });

    const customer = await prisma.customer.create({
      data: { cityId: city.id, name: customerName, isActive: true },
    });
    const product = await prisma.product.create({
      data: { name: productName, isActive: true },
    });
    const godown = await prisma.godown.create({
      data: { cityId: city.id, name: godownName, isActive: true },
    });
    const lot = await prisma.lot.create({
      data: {
        countryId: city.countryId,
        lotNumber,
        lotDate: new Date(today),
        status: "ongoing",
        createdBy: admin.id,
      },
    });
    const distribution = await prisma.lotCityDistribution.create({
      data: { lotId: lot.id, cityId: city.id, productId: product.id, allocatedQty: 100 },
    });
    const allocation = await prisma.lotCityGodownAllocation.create({
      data: {
        lotCityDistributionId: distribution.id,
        godownId: godown.id,
        productId: product.id,
        qty: 100,
      },
    });
    const valuation = await prisma.openingInventoryValuation.create({
      data: {
        lotId: lot.id,
        productId: product.id,
        quantity: 100,
        unitCostPkr: 50,
        totalValuePkr: 5_000,
        openingDate: new Date(today),
        createdBy: admin.id,
      },
    });

    let saleId: number | null = null;
    let paymentId: number | null = null;

    try {
      await loginAsCityAdmin(page);

      const dashboardBeforeResponse = await page.request.get("/api/v1/dashboard");
      expect(dashboardBeforeResponse.ok()).toBe(true);
      const dashboardBefore = (await dashboardBeforeResponse.json()).data;
      const financeBeforeResponse = await page.request.get("/api/v1/finance/combined?page=1&limit=1");
      expect(financeBeforeResponse.ok()).toBe(true);
      const financeBefore = await financeBeforeResponse.json();
      const outstandingBefore = Number(dashboardBefore.outstandingByCurrency?.PKR || 0);
      const cashBefore = Number(dashboardBefore.cashPositionByCurrency?.PKR || 0);
      const runningBalanceBefore = Number(financeBefore.meta?.currentBalanceByCurrency?.PKR || 0);

      await page.getByRole("button", { name: /^sale$/i }).click();
      const saleFrame = page.frameLocator('iframe[title="Sale form"]');
      await expect(saleFrame.getByPlaceholder(/search customer/i)).toBeVisible();

      const saleGodown = saleFrame.locator("select").filter({
        has: saleFrame.locator("option", { hasText: godownName }),
      });
      await saleGodown.selectOption(String(godown.id));

      const saleCustomer = saleFrame.getByPlaceholder(/search customer/i);
      await saleCustomer.fill(customerName);
      await saleFrame.getByRole("button", { name: customerName, exact: true }).click();

      const productSelect = saleFrame.locator("select").filter({
        has: saleFrame.locator("option", { hasText: productName }),
      });
      await productSelect.selectOption(String(product.id));
      const lotSelect = saleFrame.locator("select").filter({
        has: saleFrame.locator("option", { hasText: lotNumber }),
      });
      await lotSelect.selectOption(String(lot.id));

      const saleItemRow = productSelect.locator("xpath=..");
      await saleItemRow.locator('input[type="number"]').nth(0).fill("10");
      await saleItemRow.locator('input[type="number"]').nth(1).fill("100");
      await saleFrame.locator("label", { hasText: /^notes$/i }).locator("..").locator("input").fill(saleNote);

      const saleResponsePromise = page.waitForResponse(
        (response) => response.url().endsWith("/api/v1/sales") && response.request().method() === "POST",
      );
      await saleFrame.getByRole("button", { name: /save sale/i }).click();
      const saleResponse = await saleResponsePromise;
      expect(saleResponse.status()).toBe(201);
      const saleResponseBody = await saleResponse.json();
      saleId = Number(saleResponseBody.data.id);
      await expect(saleFrame.getByText(/sale recorded/i)).toBeVisible();

      const createdSale = await prisma.sale.findUniqueOrThrow({
        where: { id: saleId },
        include: { items: true },
      });
      expect(createdSale.customerId).toBe(customer.id);
      expect(Number(createdSale.totalAmount)).toBe(1_000);
      expect(createdSale.items).toHaveLength(1);
      expect(Number(createdSale.items[0].qty)).toBe(10);
      expect(Number(createdSale.items[0].amount)).toBe(1_000);

      const saleRequestId = saleResponse.request().headers()["x-sync-request-id"];
      expect(saleRequestId).toMatch(/^browser-/);
      const salePayload = saleResponse.request().postDataJSON();
      const [saleRetryA, saleRetryB] = await Promise.all([
        page.request.post("/api/v1/sales", { data: salePayload, headers: { "x-sync-request-id": saleRequestId } }),
        page.request.post("/api/v1/sales", { data: salePayload, headers: { "x-sync-request-id": saleRequestId } }),
      ]);
      expect(saleRetryA.ok()).toBe(true);
      expect(saleRetryB.ok()).toBe(true);
      expect(Number((await saleRetryA.json()).data.id)).toBe(saleId);
      expect(Number((await saleRetryB.json()).data.id)).toBe(saleId);
      expect(await prisma.sale.count({ where: { notes: saleNote } })).toBe(1);

      const saleJournal = await prisma.journalEntry.findMany({
        where: { transactionId: `SALE-${saleId}` },
        include: { account: true },
      });
      const cogsJournal = await prisma.journalEntry.findMany({
        where: { transactionId: `COGS-${saleId}` },
        include: { account: true },
      });
      expect(saleJournal).toHaveLength(2);
      expect(cogsJournal).toHaveLength(2);
      expect(saleJournal.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0)).toBe(0);
      expect(cogsJournal.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0)).toBe(0);
      expect(saleJournal.find((row) => row.account.code === `1200-C${customer.id}`)?.debit.toNumber()).toBe(1_000);
      expect(cogsJournal.reduce((sum, row) => sum + Number(row.debit), 0)).toBe(500);
      expect(cogsJournal.reduce((sum, row) => sum + Number(row.credit), 0)).toBe(500);

      const dashboardAfterSaleResponse = await page.request.get("/api/v1/dashboard");
      const dashboardAfterSale = (await dashboardAfterSaleResponse.json()).data;
      expect(Number(dashboardAfterSale.outstandingByCurrency.PKR)).toBe(outstandingBefore + 1_000);
      expect(Number(dashboardAfterSale.cashPositionByCurrency?.PKR || 0)).toBe(cashBefore);

      await page.getByRole("button", { name: /close form/i }).click();
      await page.getByRole("button", { name: /^payment$/i }).click();
      const paymentFrame = page.frameLocator('iframe[title="Payment form"]');
      await expect(paymentFrame.getByPlaceholder(/search customer/i)).toBeVisible();

      const paymentCustomer = paymentFrame.getByPlaceholder(/search customer/i);
      await paymentCustomer.fill(customerName);
      await paymentFrame.getByRole("button", { name: customerName, exact: true }).click();
      await paymentFrame.locator("label", { hasText: /^amount/i }).locator("..").locator("input").fill("250");
      await paymentFrame.getByPlaceholder("e.g. REF-1024").fill(paymentReference);
      await paymentFrame.getByPlaceholder(/^notes$/i).fill(paymentNote);

      const paymentResponsePromise = page.waitForResponse(
        (response) => response.url().endsWith("/api/v1/payments") && response.request().method() === "POST",
      );
      await paymentFrame.getByRole("button", { name: /save payment/i }).click();
      const paymentResponse = await paymentResponsePromise;
      expect(paymentResponse.status()).toBe(201);
      const paymentResponseBody = await paymentResponse.json();
      paymentId = Number(paymentResponseBody.data.id);
      await expect(paymentFrame.getByText(/entry recorded/i)).toBeVisible();

      const createdPayment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
      expect(createdPayment.customerId).toBe(customer.id);
      expect(Number(createdPayment.amount)).toBe(250);
      expect(createdPayment.paymentMethod).toBe("cash");
      expect(createdPayment.destination).toBe("our_account");
      expect(createdPayment.manualVoucherNo).toBe(paymentReference);

      const paymentRequestId = paymentResponse.request().headers()["x-sync-request-id"];
      expect(paymentRequestId).toMatch(/^browser-/);
      const paymentPayload = paymentResponse.request().postDataJSON();
      const [paymentRetryA, paymentRetryB] = await Promise.all([
        page.request.post("/api/v1/payments", { data: paymentPayload, headers: { "x-sync-request-id": paymentRequestId } }),
        page.request.post("/api/v1/payments", { data: paymentPayload, headers: { "x-sync-request-id": paymentRequestId } }),
      ]);
      expect(paymentRetryA.ok()).toBe(true);
      expect(paymentRetryB.ok()).toBe(true);
      expect(Number((await paymentRetryA.json()).data.id)).toBe(paymentId);
      expect(Number((await paymentRetryB.json()).data.id)).toBe(paymentId);
      expect(await prisma.payment.count({ where: { notes: paymentNote } })).toBe(1);

      const paymentJournal = await prisma.journalEntry.findMany({
        where: { transactionId: `PAY-${paymentId}` },
        include: { account: true },
      });
      expect(paymentJournal).toHaveLength(2);
      expect(paymentJournal.reduce((sum, row) => sum + Number(row.debit) - Number(row.credit), 0)).toBe(0);
      expect(paymentJournal.find((row) => row.account.code === `1200-C${customer.id}`)?.credit.toNumber()).toBe(250);
      expect(paymentJournal.some((row) => row.account.accountType === "revenue" || row.account.accountType === "expense")).toBe(false);

      const customerLedgerResponse = await page.request.get(`/api/v1/customers/${customer.id}`);
      expect(customerLedgerResponse.ok()).toBe(true);
      const customerLedger = (await customerLedgerResponse.json()).data;
      expect(customerLedger.balanceByCurrency.PKR).toBe(750);
      expect(customerLedger.ledger.some((row: any) => row.type === "sale" && row.debit === 1_000)).toBe(true);
      expect(customerLedger.ledger.some((row: any) => row.type === "payment" && row.credit === 250)).toBe(true);

      const financeAfterResponse = await page.request.get(`/api/v1/finance/combined?page=1&limit=20&q=${encodeURIComponent(paymentNote)}`);
      expect(financeAfterResponse.ok()).toBe(true);
      const financeAfter = await financeAfterResponse.json();
      const paymentLedgerRow = financeAfter.data.find((row: any) => row.type === "payment" && row.id === paymentId);
      expect(paymentLedgerRow).toBeTruthy();
      expect(Number.isFinite(Number(paymentLedgerRow.runningBalance))).toBe(true);
      expect(Number(financeAfter.meta.currentBalanceByCurrency.PKR)).toBe(runningBalanceBefore + 250);

      const dashboardAfterPaymentResponse = await page.request.get("/api/v1/dashboard");
      expect(dashboardAfterPaymentResponse.ok()).toBe(true);
      const dashboardAfterPayment = (await dashboardAfterPaymentResponse.json()).data;
      expect(Number(dashboardAfterPayment.outstandingByCurrency.PKR)).toBe(outstandingBefore + 750);
      expect(Number(dashboardAfterPayment.cashPositionByCurrency.PKR)).toBe(cashBefore + 250);
    } finally {
      const payments = await prisma.payment.findMany({
        where: { OR: [{ id: paymentId || -1 }, { notes: paymentNote }] },
        select: { id: true },
      });
      const sales = await prisma.sale.findMany({
        where: { OR: [{ id: saleId || -1 }, { notes: saleNote }] },
        select: { id: true },
      });
      const paymentIds = payments.map((row) => row.id);
      const saleIds = sales.map((row) => row.id);
      const transactionIds = [
        ...paymentIds.flatMap((id) => [`PAY-${id}`, `REV-PAY-${id}`]),
        ...saleIds.flatMap((id) => [`SALE-${id}`, `COGS-${id}`, `REV-SALE-${id}`, `REV-COGS-${id}`]),
      ];
      await prisma.syncRequest.deleteMany({
        where: {
          OR: [
            { module: "payments.create", entityId: { in: paymentIds.length ? paymentIds : [-1] } },
            { module: "sales.create", entityId: { in: saleIds.length ? saleIds : [-1] } },
          ],
        },
      });
      await prisma.auditLog.deleteMany({
        where: {
          OR: [
            { entityType: "payments", entityId: { in: paymentIds.length ? paymentIds : [-1] } },
            { entityType: "sales", entityId: { in: saleIds.length ? saleIds : [-1] } },
          ],
        },
      });
      await prisma.journalEntry.deleteMany({ where: { transactionId: { in: transactionIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds.length ? paymentIds : [-1] } } });
      await prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds.length ? saleIds : [-1] } } });
      await prisma.sale.deleteMany({ where: { id: { in: saleIds.length ? saleIds : [-1] } } });
      await prisma.openingInventoryValuation.deleteMany({ where: { id: valuation.id } });
      await prisma.lotCityGodownAllocation.deleteMany({ where: { id: allocation.id } });
      await prisma.lotCityDistribution.deleteMany({ where: { id: distribution.id } });
      await prisma.lot.deleteMany({ where: { id: lot.id } });
      await prisma.godown.deleteMany({ where: { id: godown.id } });
      await prisma.account.deleteMany({ where: { code: `1200-C${customer.id}`, journalEntries: { none: {} } } });
      await prisma.customer.deleteMany({ where: { id: customer.id } });
      await prisma.product.deleteMany({ where: { id: product.id } });
    }
  });
});
