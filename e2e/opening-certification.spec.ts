import { expect, test } from "@playwright/test";
import prisma from "../src/lib/prisma";
import { loginAsCityAdmin, loginAsSuperAdmin } from "./helpers";

const date = "2026-10-03";

async function post(page: any, url: string, data: Record<string, unknown>, expected = 200) {
  const response = await page.request.post(url, { data });
  expect(response.status(), `${url}: ${await response.text()}`).toBe(expected);
  return response.json();
}

test.describe("opening window professional certification", () => {
  let quettaId = 0;
  let pkrId = 0;
  let customerReceivableId = 0;
  let customerAdvanceId = 0;
  let bankAccountId = 0;
  let cityLiabilityAccountId = 0;
  let superAdminAccountId = 0;
  let participantId = 0;
  let supplierId = 0;
  let godownId = 0;
  let productId = 0;

  test.beforeAll(async () => {
    const quetta = await prisma.city.findFirstOrThrow({ where: { name: "Quetta" } });
    const pkr = await prisma.currency.findUniqueOrThrow({ where: { code: "PKR" } });
    const cityAdmin = await prisma.user.findUniqueOrThrow({ where: { username: "quetta_admin" } });
    const superAdmin = await prisma.user.findUniqueOrThrow({ where: { username: "superadmin" } });
    const godown = await prisma.godown.findFirstOrThrow({ where: { cityId: quetta.id, isActive: true, name: { not: "E2E-Godown" } } });
    const product = await prisma.product.findFirstOrThrow({ where: { isActive: true } });
    const supplier = await prisma.supplier.findFirstOrThrow({ where: { isActive: true } });
    await prisma.city.updateMany({ where: { id: { not: quetta.id } }, data: { isActive: false } });
    const receivableCustomer = await prisma.customer.findFirst({ where: { cityId: quetta.id, name: "CERT Opening Receivable" } })
      ?? await prisma.customer.create({ data: { cityId: quetta.id, name: "CERT Opening Receivable" } });
    const advanceCustomer = await prisma.customer.findFirst({ where: { cityId: quetta.id, name: "CERT Opening Advance" } })
      ?? await prisma.customer.create({ data: { cityId: quetta.id, name: "CERT Opening Advance" } });
    const bank = await prisma.bankAccount.findFirst({ where: { cityId: quetta.id, accountNumber: "CERT-001" } })
      ?? await prisma.bankAccount.create({ data: { cityId: quetta.id, bankName: "CERT City Bank", accountNumber: "CERT-001" } });
    const liability = await prisma.cityLiabilityAccount.findFirst({ where: { cityId: quetta.id, name: "CERT City Payable" } })
      ?? await prisma.cityLiabilityAccount.create({ data: { cityId: quetta.id, name: "CERT City Payable", createdBy: cityAdmin.id } });
    const superAccount = await prisma.superAdminBankAccount.findFirst({ where: { bankName: "CERT Superadmin Cash" } })
      ?? await prisma.superAdminBankAccount.create({ data: { bankName: "CERT Superadmin Cash", currencyId: pkr.id, accountKind: "cash", createdBy: superAdmin.id } });
    const participant = await prisma.investmentParticipant.findFirst({ where: { name: "CERT Manager" } })
      ?? await prisma.investmentParticipant.create({ data: { name: "CERT Manager", type: "manager", createdBy: superAdmin.id } });
    quettaId = quetta.id;
    pkrId = pkr.id;
    customerReceivableId = receivableCustomer.id;
    customerAdvanceId = advanceCustomer.id;
    bankAccountId = bank.id;
    cityLiabilityAccountId = liability.id;
    superAdminAccountId = superAccount.id;
    participantId = participant.id;
    supplierId = supplier.id;
    godownId = godown.id;
    productId = product.id;
  });

  test("cheque form owns its customer selector", async ({ page }) => {
    await loginAsCityAdmin(page, "quetta_admin", "city12345");
    await page.goto("/openings");
    const chequeForm = page.getByRole("heading", { name: "Opening cheques in hand" }).locator("xpath=ancestor::form");
    await expect(chequeForm.locator("select").filter({ hasText: "Customer who issued the cheque" })).toBeVisible();
  });

  test("draft opening cheque edits in place through the form", async ({ browser }) => {
    const superPage = await (await browser.newContext()).newPage();
    const cityPage = await (await browser.newContext()).newPage();
    await loginAsSuperAdmin(superPage);
    await post(superPage, "/api/v1/opening-cutover", {
      action: "save_setup", cutoverDate: date, fiscalYearStart: "2026-01-01", fiscalYearEnd: "2026-12-31",
      backupReference: "CERT-CHEQUE-EDIT", backupAcknowledged: true,
    });
    await loginAsCityAdmin(cityPage, "quetta_admin", "city12345");
    const created = await post(cityPage, "/api/v1/openings", {
      kind: "cheque", customerId: customerReceivableId, currencyId: pkrId, amount: 20,
      chequeNumber: "CERT-UI-EDIT", chequeDueDate: date, openingDate: date,
    });

    await cityPage.goto("/openings");
    const row = cityPage.getByRole("row", { name: /CERT-UI-EDIT/ });
    await row.getByRole("button", { name: "Edit" }).click();
    const form = cityPage.getByRole("heading", { name: "Opening cheques in hand" }).locator("xpath=ancestor::form");
    await expect(form.getByPlaceholder("Cheque #")).toHaveValue("CERT-UI-EDIT");
    await form.getByPlaceholder("Amount").fill("25");
    await form.getByPlaceholder("Cheque #").fill("CERT-UI-EDITED");
    expect(await form.locator(":invalid").count()).toBe(0);
    const updateResponse = cityPage.waitForResponse((response) => response.url().endsWith("/api/v1/openings") && response.request().method() === "POST");
    await form.getByRole("button", { name: "Update opening cheque" }).click();
    const response = await updateResponse;
    expect(response.status(), await response.text()).toBe(200);
    await expect(cityPage.getByRole("row", { name: /CERT-UI-EDITED/ })).toContainText("25");
    const saved = await prisma.openingCheque.findUniqueOrThrow({ where: { id: created.data.id } });
    expect(Number(saved.amount)).toBe(25);
    expect(saved.chequeNumber).toBe("CERT-UI-EDITED");
  });

  test("cheque edit reverses and reposts while used cheques stay locked", async ({ page }) => {
    await loginAsCityAdmin(page, "quetta_admin", "city12345");
    const created = await post(page, "/api/v1/openings", {
      kind: "cheque", customerId: customerReceivableId, currencyId: pkrId, amount: 30,
      chequeNumber: "CERT-API-EDIT", chequeDueDate: date, openingDate: date,
    });
    const id = created.data.id;
    const edited = await post(page, "/api/v1/openings", {
      kind: "cheque", id, customerId: customerAdvanceId, currencyId: pkrId, amount: 35,
      chequeNumber: "CERT-API-EDITED", chequeDueDate: date, openingDate: date,
    });
    expect(edited.data.id).toBe(id);
    expect(await prisma.openingCheque.count({ where: { id } })).toBe(1);
    expect(await prisma.journalEntry.count({ where: { transactionId: `OPENCHEQUE-${id}-V2` } })).toBe(2);
    expect(await prisma.journalEntry.count({ where: { transactionId: `REV-OPENCHEQUE-${id}-V1` } })).toBe(2);

    await prisma.openingCheque.update({ where: { id }, data: { chequeStatus: "bounced" } });
    await post(page, "/api/v1/openings", {
      kind: "cheque", id, customerId: customerReceivableId, currencyId: pkrId, amount: 40,
      chequeNumber: "CERT-LOCKED", chequeDueDate: date, openingDate: date,
    }, 409);
    await prisma.openingCheque.update({ where: { id }, data: { chequeStatus: "in_hand" } });
  });

  test("treasury includes only in-hand opening customer cheques", async ({ browser }) => {
    const superPage = await (await browser.newContext()).newPage();
    const cityPage = await (await browser.newContext()).newPage();
    await loginAsSuperAdmin(superPage);
    await post(superPage, "/api/v1/opening-cutover", {
      action: "save_setup", cutoverDate: date, fiscalYearStart: "2026-01-01", fiscalYearEnd: "2026-12-31",
      backupReference: "CERT-TREASURY-CHEQUES", backupAcknowledged: true,
    });
    await loginAsCityAdmin(cityPage, "quetta_admin", "city12345");

    const treasuryBefore = await (await cityPage.request.get(`/api/v1/treasury?cityId=${quettaId}`)).json();
    const pkrBefore = Number(treasuryBefore.data.chequesInHand.PKR || 0);
    const paymentCountBefore = await prisma.payment.count({ where: { customerId: customerReceivableId } });
    const created = await post(cityPage, "/api/v1/openings", {
      kind: "cheque", customerId: customerReceivableId, currencyId: pkrId, amount: 45,
      chequeNumber: "CERT-TREASURY-BOUNCE", chequeDueDate: date, openingDate: date,
    });
    let treasury = await (await cityPage.request.get(`/api/v1/treasury?cityId=${quettaId}`)).json();
    expect(treasury.data.chequesInHand.PKR).toBe(pkrBefore + 45);

    await post(cityPage, "/api/v1/openings", {
      kind: "cheque", id: created.data.id, customerId: customerReceivableId, currencyId: pkrId, amount: 55,
      chequeNumber: "CERT-TREASURY-BOUNCE", chequeDueDate: date, openingDate: date,
    });
    treasury = await (await cityPage.request.get(`/api/v1/treasury?cityId=${quettaId}`)).json();
    expect(treasury.data.chequesInHand.PKR).toBe(pkrBefore + 55);

    await post(cityPage, `/api/v1/opening-cheques/${created.data.id}/bounce`, { reason: "CERT treasury lifecycle" });
    treasury = await (await cityPage.request.get(`/api/v1/treasury?cityId=${quettaId}`)).json();
    expect(Number(treasury.data.chequesInHand.PKR || 0)).toBe(pkrBefore);

    const deleted = await post(cityPage, "/api/v1/openings", {
      kind: "cheque", customerId: customerReceivableId, currencyId: pkrId, amount: 15,
      chequeNumber: "CERT-TREASURY-DELETE", chequeDueDate: date, openingDate: date,
    });
    treasury = await (await cityPage.request.get(`/api/v1/treasury?cityId=${quettaId}`)).json();
    expect(treasury.data.chequesInHand.PKR).toBe(pkrBefore + 15);
    const deletedResponse = await cityPage.request.delete(`/api/v1/openings?kind=cheque&id=${deleted.data.id}`);
    expect(deletedResponse.status(), await deletedResponse.text()).toBe(200);
    treasury = await (await cityPage.request.get(`/api/v1/treasury?cityId=${quettaId}`)).json();
    expect(Number(treasury.data.chequesInHand.PKR || 0)).toBe(pkrBefore);
    expect(await prisma.payment.count({ where: { customerId: customerReceivableId } })).toBe(paymentCountBefore);
  });

  test("superadmin account opening posts through its public API", async ({ page }) => {
    await loginAsSuperAdmin(page);
    await post(page, "/api/v1/opening-cutover", {
      action: "save_setup", cutoverDate: date, fiscalYearStart: "2026-01-01", fiscalYearEnd: "2026-12-31",
      backupReference: "CERT-ACCOUNT-OPENING", backupAcknowledged: true,
    });
    await post(page, "/api/v1/openings", { kind: "super_admin_account", accountId: superAdminAccountId, amount: 10, openingDate: date });
  });

  test("form to cutover lifecycle reconciles and locks", async ({ browser }) => {
    const superContext = await browser.newContext();
    const cityContext = await browser.newContext();
    const superPage = await superContext.newPage();
    const cityPage = await cityContext.newPage();
    await loginAsSuperAdmin(superPage);
    await post(superPage, "/api/v1/opening-cutover", {
      action: "save_setup", cutoverDate: date, fiscalYearStart: "2026-01-01", fiscalYearEnd: "2026-12-31",
      backupReference: "CERT-RESTORE-20261003", backupAcknowledged: true,
    });

    await loginAsCityAdmin(cityPage, "quetta_admin", "city12345");
    const dashboardBefore = await (await cityPage.request.get("/api/v1/dashboard")).json();
    const treasuryBefore = await (await cityPage.request.get(`/api/v1/treasury?cityId=${quettaId}`)).json();
    await cityPage.goto("/openings");
    const cashForm = cityPage.getByRole("heading", { name: "Opening balance (cash)" }).locator("xpath=ancestor::form");
    const cashCurrency = cashForm.getByRole("combobox");
    if (await cashCurrency.count()) await cashCurrency.selectOption(String(pkrId));
    await cashForm.getByPlaceholder("Amount").fill("100");
    await cashForm.locator('input[type="date"]').fill(date);
    await cashForm.getByPlaceholder("Notes (optional)").fill("CERT cash first version");
    await cashForm.getByRole("button", { name: "Save opening cash" }).click();
    await expect(cashForm.getByText("100", { exact: true })).toBeVisible();
    await cashForm.getByPlaceholder("Amount").fill("120");
    await cashForm.getByPlaceholder("Notes (optional)").fill("CERT cash replacement");
    await cashForm.getByRole("button", { name: "Save opening cash" }).click();
    await expect(cashForm.getByText("120", { exact: true })).toBeVisible();

    const cityOpeningPayloads = [
      { kind: "customer", customerId: customerReceivableId, currencyId: pkrId, amount: 40, balanceSide: "receivable", openingDate: date },
      { kind: "customer", customerId: customerAdvanceId, currencyId: pkrId, amount: 10, balanceSide: "advance", openingDate: date },
      { kind: "bank", bankAccountId, currencyId: pkrId, amount: 50, openingDate: date },
      { kind: "cheque", customerId: customerReceivableId, currencyId: pkrId, amount: 20, chequeNumber: "CERT-CHQ-1", chequeDueDate: date, openingDate: date },
      { kind: "haji", currencyId: pkrId, amount: 30, balanceSide: "payable", openingDate: date },
      { kind: "product_inventory", godownId, productId, quantity: 2, unitCostPkr: 25, openingDate: date, notes: "CERT valuation" },
      { kind: "city_liability", accountId: cityLiabilityAccountId, currencyId: pkrId, amount: 15, openingDate: date },
    ];
    for (const payload of cityOpeningPayloads) await post(cityPage, "/api/v1/openings", payload);
    const invalid = await cityPage.request.post("/api/v1/openings", { data: { kind: "cash", currencyId: pkrId, amount: 0, openingDate: date } });
    expect(invalid.status()).toBe(400);

    const enabledCurrencies = await prisma.cityCurrency.findMany({ where: { cityId: quettaId }, select: { currencyId: true } });
    for (const { currencyId } of enabledCurrencies) {
      await post(cityPage, "/api/v1/opening-city-packages", { action: "save_due", currencyId, cityAmount: 0, cityCarryingPkr: 0 });
    }
    let packages = await (await cityPage.request.get("/api/v1/opening-city-packages")).json();
    const packageId = packages.data.packages[0].id;
    await post(cityPage, "/api/v1/opening-city-packages", { action: "submit", packageId });

    expect(await prisma.payment.count({ where: { customerId: { in: [customerReceivableId, customerAdvanceId] } } })).toBe(0);
    const customerLedger = await (await cityPage.request.get(`/api/v1/customers/${customerReceivableId}`)).json();
    expect(customerLedger.data.ledger.find((row: any) => row.type === "opening")).toMatchObject({ debit: 40, credit: 0, balance: 40 });
    const dashboard = await (await cityPage.request.get("/api/v1/dashboard")).json();
    expect(dashboard.data.cashPositionByCurrency.PKR).toBe(Number(dashboardBefore.data.cashPositionByCurrency.PKR || 0) + 120);
    expect(dashboard.data.outstandingByCurrency.PKR).toBe(Number(dashboardBefore.data.outstandingByCurrency.PKR || 0) + 30);
    const treasury = await (await cityPage.request.get(`/api/v1/treasury?cityId=${quettaId}`)).json();
    expect(treasury.data.cashInOffice.PKR).toBe(Number(treasuryBefore.data.cashInOffice.PKR || 0) + 120);

    await post(superPage, "/api/v1/openings", { kind: "liability", liabilityType: "supplier", partyId: supplierId, currencyId: pkrId, amount: 25, balanceSide: "payable", openingDate: date });
    for (const { currencyId } of enabledCurrencies) {
      await post(superPage, "/api/v1/opening-city-packages", { action: "save_due", cityId: quettaId, currencyId, centralAmount: 0, centralCarryingPkr: 0 });
    }
    packages = await (await superPage.request.get("/api/v1/opening-city-packages")).json();
    await post(superPage, "/api/v1/opening-city-packages", { action: "approve", packageId: packages.data.packages[0].id });

    let cutover = await (await superPage.request.get("/api/v1/opening-cutover")).json();
    const capital = Number(cutover.data.readiness.openingClearingPkr);
    expect(capital).toBeGreaterThan(0);
    await post(superPage, "/api/v1/opening-cutover", {
      action: "save_participant_balance", participantId, capitalPkr: capital,
      currentYearProfitPkr: 0, ongoingLotRealizedProfitPkr: 0, openingDate: date, notes: "CERT reconciler",
    });
    cutover = await (await superPage.request.get("/api/v1/opening-cutover")).json();
    expect(cutover.data.readiness, JSON.stringify(cutover.data.readiness.blockers)).toMatchObject({ ready: true, openingClearingPkr: 0 });

    const journalTotals = await prisma.journalEntry.aggregate({ _sum: { debit: true, credit: true } });
    expect(Number(journalTotals._sum.debit)).toBe(Number(journalTotals._sum.credit));
    const unbalanced = await prisma.$queryRaw<Array<{ transaction_id: string }>>`
      SELECT transaction_id FROM journal_entries GROUP BY transaction_id
      HAVING ABS(SUM(debit) - SUM(credit)) >= 0.01
    `;
    expect(unbalanced).toEqual([]);

    await superPage.goto("/openings");
    await expect(superPage.getByText("Ready to finalize")).toBeVisible();
    await superPage.getByPlaceholder("Type FINALIZE OPENINGS").fill("FINALIZE OPENINGS");
    superPage.once("dialog", (dialog) => dialog.accept());
    await superPage.getByRole("button", { name: "Finalize openings" }).click();
    await expect(superPage.getByText("Finalized and locked")).toBeVisible();

    const finalized = await prisma.openingCutover.findFirstOrThrow({ orderBy: { revision: "desc" } });
    expect(finalized.status).toBe("finalized");
    expect(finalized.finalSnapshotHash).toMatch(/^[a-f0-9]{64}$/);
    expect(finalized.finalSnapshotJson).toBeTruthy();
    expect(await prisma.financialYear.count()).toBe(1);
    const blocked = await cityPage.request.post("/api/v1/openings", { data: { kind: "cash", currencyId: pkrId, amount: 130, openingDate: date } });
    expect(blocked.status()).toBe(403);
    const setupEdit = await superPage.request.post("/api/v1/opening-cutover", { data: {
      action: "save_setup", cutoverDate: date, fiscalYearStart: "2026-01-01", fiscalYearEnd: "2026-12-31",
      backupReference: "CERT-FINALIZED-EDIT", backupAcknowledged: true,
    } });
    expect(setupEdit.status()).toBe(409);
    await cityPage.reload();
    await expect(cityPage.getByRole("button", { name: "Save opening cash" })).toBeDisabled();
    await superContext.close();
    await cityContext.close();
  });
});
