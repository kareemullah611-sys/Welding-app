import prisma from "@/lib/prisma";
import { AccountType, Prisma, PrismaClient } from "@prisma/client";
import { computeLotLandedCostPkr } from "@/lib/landed-cost-pkr";
import { getCountryFallbackRateToPkr } from "@/lib/intermediary-usd-fifo";
import { buildRealizedFxPostingAmounts, settlementJournalTransactionId } from "@/lib/realized-liability-fx";
import { historicalOpeningAdjustmentTransactionId } from "@/lib/historical-opening-accounting";

type DbClient = PrismaClient | Prisma.TransactionClient;

async function getOrCreateAccount(code: string, name: string, type: AccountType, cityId?: number | null, db: DbClient = prisma): Promise<number> {
  const acc = await db.account.upsert({
    where: { code },
    update: {},
    create: { code, name, accountType: type, cityId: cityId || null, isSystem: true },
  });
  return acc.id;
}

export async function getCashAccountId(cityId: number, db: DbClient = prisma): Promise<number> {
  const city = await db.city.findUnique({ where: { id: cityId }, select: { name: true } });
  return getOrCreateAccount(`1001-CITY${cityId}`, `Cash - ${city?.name || cityId}`, "asset", cityId, db);
}

export async function getChequesInHandAccountId(cityId: number, db: DbClient = prisma): Promise<number> {
  const city = await db.city.findUnique({ where: { id: cityId }, select: { name: true } });
  return getOrCreateAccount(`1002-CHEQUE${cityId}`, `Cheques in Hand - ${city?.name || cityId}`, "asset", cityId, db);
}

export async function getBankGLAccountId(bankAccountId: number, db: DbClient = prisma): Promise<number> {
  const bank = await db.bankAccount.findUnique({ where: { id: bankAccountId }, select: { bankName: true, accountNumber: true } });
  const label = bank ? `${bank.bankName} ${bank.accountNumber}` : `Bank #${bankAccountId}`;
  return getOrCreateAccount(`1050-BANK${bankAccountId}`, `Bank - ${label}`, "asset", undefined, db);
}
export async function getSuperAdminBankGLAccountId(bankAccountId: number, db: DbClient = prisma): Promise<number> {
  const bank = await db.superAdminBankAccount.findUnique({ where: { id: bankAccountId }, select: { bankName: true, accountNumber: true } });
  const label = bank ? `${bank.bankName} ${bank.accountNumber || ""}`.trim() : `SA Bank #${bankAccountId}`;
  return getOrCreateAccount(`1050-SABANK${bankAccountId}`, `Super Admin Bank - ${label}`, "asset", undefined, db);
}

export async function getSuperAdminCashGLAccountId(cashAccountId: number, db: DbClient = prisma): Promise<number> {
  const acct = await db.superAdminBankAccount.findUnique({
    where: { id: cashAccountId },
    select: { bankName: true, currency: { select: { code: true } } },
  });
  const label = acct ? `${acct.bankName}${acct.currency?.code ? ` (${acct.currency.code})` : ""}` : `SA Cash #${cashAccountId}`;
  return getOrCreateAccount(`1051-SACASH${cashAccountId}`, `Super Admin Cash - ${label}`, "asset", undefined, db);
}

export async function getCustomerAccountId(customerId: number, db: DbClient = prisma): Promise<number> {
  const customer = await db.customer.findUnique({ where: { id: customerId }, select: { name: true } });
  return getOrCreateAccount(`1200-C${customerId}`, `AR - ${customer?.name || customerId}`, "asset", undefined, db);
}

export async function getCityLiabilityAccountId(accountId: number, db: DbClient = prisma): Promise<number> {
  const account = await db.cityLiabilityAccount.findUnique({
    where: { id: accountId },
    select: { name: true, cityId: true },
  });
  return getOrCreateAccount(
    `2400-CL${accountId}`,
    `City Payable - ${account?.name || accountId}`,
    "liability",
    account?.cityId ?? undefined,
    db,
  );
}

export async function getSupplierAccountId(supplierId: number, db: DbClient = prisma): Promise<number> {
  const supplier = await db.supplier.findUnique({ where: { id: supplierId }, select: { name: true } });
  return getOrCreateAccount(`2100-S${supplierId}`, `Payable - ${supplier?.name || supplierId}`, "liability", undefined, db);
}

export async function getAgentAccountId(agentId: number, db: DbClient = prisma): Promise<number> {
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { name: true } });
  return getOrCreateAccount(`2200-A${agentId}`, `Payable - ${agent?.name || agentId}`, "liability", undefined, db);
}

export async function getShippingLineAccountId(shippingLineId: number, db: DbClient = prisma): Promise<number> {
  const sl = await db.shippingLine.findUnique({ where: { id: shippingLineId }, select: { name: true } });
  return getOrCreateAccount(`2300-SL${shippingLineId}`, `Payable - ${sl?.name || shippingLineId}`, "liability", undefined, db);
}

export async function getInventoryAccountId(db: DbClient = prisma): Promise<number> { return getOrCreateAccount("1100", "Inventory", "asset", undefined, db); }
export async function getSalesRevenueAccountId(db: DbClient = prisma): Promise<number> { return getOrCreateAccount("3001", "Sales Revenue", "revenue", undefined, db); }
export async function getCOGSAccountId(db: DbClient = prisma): Promise<number> { return getOrCreateAccount("4001", "Cost of Goods Sold", "cogs", undefined, db); }
export async function getOwnerWithdrawalAccountId(db: DbClient = prisma): Promise<number> { return getOrCreateAccount("6002", "Owner Withdrawals", "equity", undefined, db); }
export async function getHajiAccountId(db: DbClient = prisma): Promise<number> { return getOrCreateAccount("6003", "Haji Account", "equity", undefined, db); }
export async function getHajiReceivableAccountId(cityId: number, db: DbClient = prisma): Promise<number> {
  const city = await db.city.findUnique({ where: { id: cityId }, select: { name: true } });
  return getOrCreateAccount(`1250-H${cityId}`, `Due from Haji - ${city?.name || cityId}`, "asset", cityId, db);
}
export async function getHajiPayableAccountId(cityId: number, db: DbClient = prisma): Promise<number> {
  const city = await db.city.findUnique({ where: { id: cityId }, select: { name: true } });
  return getOrCreateAccount(`2450-H${cityId}`, `Owed to Haji - ${city?.name || cityId}`, "liability", cityId, db);
}
export async function getOpeningBalanceAccountId(db: DbClient = prisma): Promise<number> { return getOrCreateAccount("3900", "Opening Balances", "equity", undefined, db); }
export async function getHistoricalStockAdjustmentAccountId(db: DbClient = prisma): Promise<number> { return getOrCreateAccount("3901", "Historical Stock Adjustment", "equity", undefined, db); }
export async function getBankAccountId(db: DbClient = prisma): Promise<number> { return getOrCreateAccount("1050", "Bank Account (USD)", "asset", undefined, db); }
export async function getInvestorSettlementPayableAccountId(db: DbClient = prisma): Promise<number> {
  return getOrCreateAccount("2600-INVSETTLE", "Investor Settlement Payable", "liability", undefined, db);
}
export async function getForeignExchangeGainAccountId(db: DbClient = prisma): Promise<number> {
  return getOrCreateAccount("FX-GAIN", "Foreign Exchange Gain", "revenue", undefined, db);
}
export async function getForeignExchangeLossAccountId(db: DbClient = prisma): Promise<number> {
  return getOrCreateAccount("FX-LOSS", "Foreign Exchange Loss", "expense", undefined, db);
}

export function resolveOpeningCarryingAmount(input: {
  amount: number;
  currencyCode: string;
  carryingAmountPkr?: number | null;
  fxRateToPkr?: number | null;
}) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount === 0) throw new Error("Opening amount must be non-zero.");
  const currencyCode = String(input.currencyCode || "").toUpperCase();
  if (currencyCode === "PKR") {
    const carryingAmountPkr = Number(input.carryingAmountPkr ?? amount);
    if (Math.abs(carryingAmountPkr - amount) > 0.01) throw new Error("PKR opening amount and PKR carrying amount must match.");
    return { carryingAmountPkr: roundMoney(carryingAmountPkr), fxRateToPkr: 1 };
  }
  const carryingAmountPkr = Number(input.carryingAmountPkr);
  const fxRateToPkr = Number(input.fxRateToPkr);
  if (!Number.isFinite(carryingAmountPkr) || carryingAmountPkr === 0) throw new Error(`PKR carrying amount is required for ${currencyCode} openings.`);
  if (!Number.isFinite(fxRateToPkr) || fxRateToPkr <= 0) throw new Error(`Historical ${currencyCode} to PKR rate is required.`);
  const expected = roundMoney(new Prisma.Decimal(amount).mul(fxRateToPkr));
  if (Math.abs(expected - carryingAmountPkr) > 0.01) throw new Error("Opening PKR carrying amount does not match the original amount and FX rate.");
  return { carryingAmountPkr: roundMoney(carryingAmountPkr), fxRateToPkr };
}

export async function getExpenseAccountId(costType: string, db: DbClient = prisma): Promise<number> {
  const m: Record<string, { code: string; name: string }> = {
    customs_duty: { code: "5001", name: "Customs Duty" }, freight: { code: "5002", name: "Freight/Shipping" },
    transport: { code: "5003", name: "Transport" }, port_charges: { code: "5004", name: "Port Charges" },
    loading_unloading: { code: "5005", name: "Loading/Unloading" }, insurance: { code: "5006", name: "Insurance" },
    customs_agent: { code: "5007", name: "Customs Agent" },
    clearing_agent: { code: "5008", name: "Clearing Agent" },
    office: { code: "5010", name: "Office Expenses" }, salary: { code: "5011", name: "Salaries" },
    other: { code: "5099", name: "Other Expenses" }, general: { code: "5099", name: "Other Expenses" },
  };
  const entry = m[costType] || m.other;
  return getOrCreateAccount(entry.code, entry.name, "expense", undefined, db);
}

interface JournalLine { accountId: number; debit: number; credit: number; description: string; currencyCode?: string; lotId?: number | null; }

function roundMoney(value: Prisma.Decimal.Value): number {
  return Number(new Prisma.Decimal(value).toDecimalPlaces(2).toString());
}

export function buildLotPurchasePkrBasis(input: { totalUsd: number; carryingRatePkr: number }) {
  const foreignAmountUsd = Number(new Prisma.Decimal(input.totalUsd).toDecimalPlaces(2).toString());
  const carryingRatePkr = Number(new Prisma.Decimal(input.carryingRatePkr).toDecimalPlaces(6).toString());
  if (foreignAmountUsd <= 0) throw new Error("Foreign purchase amount must be greater than zero.");
  if (carryingRatePkr <= 0) throw new Error("PKR recognition rate is required for a foreign lot purchase.");
  return {
    foreignAmountUsd,
    carryingRatePkr,
    carryingAmountPkr: roundMoney(new Prisma.Decimal(foreignAmountUsd).mul(carryingRatePkr)),
  };
}

export function lotPurchaseJournalTransactionId(lotId: number, purchaseId: number, journalVersion: number) {
  return journalVersion <= 1 ? `PURCH-${lotId}-${purchaseId}` : `PURCH-${lotId}-${purchaseId}-V${journalVersion}`;
}

export function personalExpenseJournalTransactionId(expenseId: number, journalVersion: number) {
  return journalVersion <= 1 ? `SAEXP-${expenseId}` : `SAEXP-${expenseId}-V${journalVersion}`;
}

export function lotCostJournalTransactionId(costId: number, journalVersion: number) {
  return journalVersion <= 1 ? `COST-${costId}` : `COST-${costId}-V${journalVersion}`;
}

export async function assertAccountingDateOpen(entryDate: Date, db: DbClient = prisma): Promise<void> {
  const financialYearModel = (db as any).financialYear;
  if (typeof financialYearModel?.findFirst !== "function") return;
  const matchingYear = await financialYearModel.findFirst({
    where: { startDate: { lte: entryDate }, endDate: { gte: entryDate } },
    select: { id: true },
  });
  if (!matchingYear) return;
  if (typeof (db as any).$executeRawUnsafe === "function") {
    await (db as any).$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
      `financial-year:${matchingYear.id}`,
    );
  }
  const closedYear = await financialYearModel.findFirst({
    where: { id: matchingYear.id, status: "closed" },
    select: { name: true, startDate: true, endDate: true },
  });
  if (closedYear) {
    throw new Error(`Accounting period ${closedYear.name} is closed; reopen it or post a controlled adjustment in an open period.`);
  }
}

export async function createJournalEntries(
  transactionId: string, lines: JournalLine[],
  meta: { currencyCode: string; exchangeRate?: number; entityType: string; entityId: number; lotId?: number | null; cityId?: number | null; entryDate: Date; createdBy: number; }
  , db: DbClient = prisma
): Promise<void> {
  const data = lines
    .filter((line) => line.debit !== 0 || line.credit !== 0)
    .map((line, index) => ({
      transactionId, accountId: line.accountId, debit: line.debit, credit: line.credit,
      lineNumber: index + 1,
      currencyCode: line.currencyCode || meta.currencyCode, exchangeRate: meta.exchangeRate || null, description: line.description,
      entityType: meta.entityType, entityId: meta.entityId, lotId: line.lotId ?? meta.lotId ?? null,
      cityId: meta.cityId || null, entryDate: meta.entryDate, createdBy: meta.createdBy,
    }));
  if (data.length > 0) {
    const currencies = new Set(data.map((line) => line.currencyCode));
    for (const currencyCode of currencies) {
      const currencyLines = data.filter((line) => line.currencyCode === currencyCode);
      const totalDebit = currencyLines.reduce((sum, line) => sum.plus(new Prisma.Decimal(line.debit)), new Prisma.Decimal(0));
      const totalCredit = currencyLines.reduce((sum, line) => sum.plus(new Prisma.Decimal(line.credit)), new Prisma.Decimal(0));
      if (totalDebit.minus(totalCredit).abs().greaterThan(new Prisma.Decimal("0.01"))) {
        throw new Error(
          `Unbalanced journal ${transactionId} (${currencyCode}): debit ${totalDebit.toFixed(2)} != credit ${totalCredit.toFixed(2)}`,
        );
      }
    }

    const write = async (tx: DbClient) => {
      await assertAccountingDateOpen(meta.entryDate, tx);
      if (typeof (tx as any).$executeRawUnsafe === "function") {
        await (tx as any).$executeRawUnsafe(
          "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
          `journal-posting:${transactionId}`,
        );
      }
      const existing = typeof (tx.journalEntry as any).findMany === "function"
        ? await tx.journalEntry.findMany({ where: { transactionId }, orderBy: { lineNumber: "asc" } })
        : [];
      if (existing.length > 0) {
        const same = existing.length === data.length && existing.every((row: any, index: number) => {
          const next = data[index];
          return row.lineNumber === next.lineNumber &&
            row.accountId === next.accountId &&
            new Prisma.Decimal(row.debit).equals(next.debit) &&
            new Prisma.Decimal(row.credit).equals(next.credit) &&
            row.currencyCode === next.currencyCode &&
            row.entityType === next.entityType &&
            row.entityId === next.entityId &&
            row.lotId === next.lotId;
        });
        if (same) return;
        throw new Error(`Journal transaction ${transactionId} already exists with different lines.`);
      }
      await tx.journalEntry.createMany({ data });
    };

    if (typeof (db as PrismaClient).$transaction === "function") {
      await (db as PrismaClient).$transaction(async (tx) => write(tx));
    } else {
      await write(db);
    }
  }
}

export async function journalSaleDiscount(d: {
  id: number;
  saleId: number;
  customerId: number;
  cityId: number;
  lotId: number;
  amount: number;
  currencyCode: string;
  discountDate: Date;
  createdBy: number;
}, db: DbClient = prisma) {
  await createJournalEntries(`DISCOUNT-${d.id}`, [
    { accountId: await getSalesRevenueAccountId(db), debit: d.amount, credit: 0, description: `Sale discount #${d.saleId}` },
    { accountId: await getCustomerAccountId(d.customerId, db), debit: 0, credit: d.amount, description: `Sale discount #${d.saleId}` },
  ], {
    currencyCode: d.currencyCode,
    entityType: "sale_discount",
    entityId: d.id,
    lotId: d.lotId,
    cityId: d.cityId,
    entryDate: d.discountDate,
    createdBy: d.createdBy,
  }, db);
}

export async function journalOpeningCustomerBalance(d: {
  id: number;
  customerId: number;
  cityId: number;
  amount: number;
  carryingAmountPkr?: number | null;
  fxRateToPkr?: number | null;
  currencyCode: string;
  openingDate: Date;
  createdBy: number;
  journalVersion: number;
}, db: DbClient = prisma) {
  const carrying = resolveOpeningCarryingAmount(d);
  const amount = Math.abs(carrying.carryingAmountPkr);
  if (amount === 0) return;
  const customerAccountId = await getCustomerAccountId(d.customerId, db);
  const openingBalanceAccountId = await getOpeningBalanceAccountId(db);
  const customerOwesUs = d.amount > 0;
  await createJournalEntries(`OPENAR-${d.id}-V${d.journalVersion}`, [
    customerOwesUs
      ? { accountId: customerAccountId, debit: amount, credit: 0, description: `Opening customer balance #${d.id}` }
      : { accountId: customerAccountId, debit: 0, credit: amount, description: `Opening customer advance #${d.id}` },
    customerOwesUs
      ? { accountId: openingBalanceAccountId, debit: 0, credit: amount, description: `Opening customer balance #${d.id}` }
      : { accountId: openingBalanceAccountId, debit: amount, credit: 0, description: `Opening customer advance #${d.id}` },
  ], {
    currencyCode: "PKR",
    exchangeRate: carrying.fxRateToPkr,
    entityType: "opening_customer_balance",
    entityId: d.id,
    cityId: d.cityId,
    entryDate: d.openingDate,
    createdBy: d.createdBy,
  }, db);
}

export async function reverseOpeningCustomerBalanceJournals(
  openingId: number,
  createdBy: number,
  db: DbClient = prisma,
) {
  const rows = await db.journalEntry.findMany({
    where: { entityType: "opening_customer_balance", entityId: openingId, transactionId: { startsWith: `OPENAR-${openingId}-V` } },
    select: { transactionId: true },
    distinct: ["transactionId"],
  });
  for (const row of rows) await reverseJournalEntries(row.transactionId, createdBy, db);
  return rows.length;
}

export async function reverseOpeningJournals(
  entityType: string,
  entityId: number,
  transactionPrefix: string,
  createdBy: number,
  db: DbClient = prisma,
) {
  const rows = await db.journalEntry.findMany({
    where: { entityType, entityId, transactionId: { startsWith: transactionPrefix } },
    select: { transactionId: true },
    distinct: ["transactionId"],
  });
  for (const row of rows) await reverseJournalEntries(row.transactionId, createdBy, db);
  return rows.length;
}

async function journalOpeningAsset(
  d: {
    transactionPrefix: string;
    entityType: string;
    entityId: number;
    cityId: number;
    amount: number;
    carryingAmountPkr?: number | null;
    fxRateToPkr?: number | null;
    currencyCode: string;
    openingDate: Date;
    createdBy: number;
    journalVersion: number;
    assetAccountId: number;
    description: string;
  },
  db: DbClient,
) {
  const carrying = resolveOpeningCarryingAmount(d);
  const amount = Math.abs(carrying.carryingAmountPkr);
  if (amount === 0) return;
  const openingBalanceAccountId = await getOpeningBalanceAccountId(db);
  const positiveAsset = d.amount > 0;
  await createJournalEntries(`${d.transactionPrefix}-V${d.journalVersion}`, [
    positiveAsset
      ? { accountId: d.assetAccountId, debit: amount, credit: 0, description: d.description }
      : { accountId: d.assetAccountId, debit: 0, credit: amount, description: d.description },
    positiveAsset
      ? { accountId: openingBalanceAccountId, debit: 0, credit: amount, description: d.description }
      : { accountId: openingBalanceAccountId, debit: amount, credit: 0, description: d.description },
  ], {
    currencyCode: "PKR",
    exchangeRate: carrying.fxRateToPkr,
    entityType: d.entityType,
    entityId: d.entityId,
    cityId: d.cityId,
    entryDate: d.openingDate,
    createdBy: d.createdBy,
  }, db);
}

export async function journalOpeningCashBalance(d: {
  id: number; cityId: number; amount: number; carryingAmountPkr?: number | null; fxRateToPkr?: number | null; currencyCode: string; openingDate: Date; createdBy: number; journalVersion: number;
}, db: DbClient = prisma) {
  await journalOpeningAsset({
    ...d,
    transactionPrefix: `OPENCASH-${d.id}`,
    entityType: "opening_cash",
    entityId: d.id,
    assetAccountId: await getCashAccountId(d.cityId, db),
    description: `Opening cash balance #${d.id}`,
  }, db);
}

export async function journalOpeningBankBalance(d: {
  id: number; cityId: number; bankAccountId: number; amount: number; carryingAmountPkr?: number | null; fxRateToPkr?: number | null; currencyCode: string; openingDate: Date; createdBy: number; journalVersion: number;
}, db: DbClient = prisma) {
  await journalOpeningAsset({
    ...d,
    transactionPrefix: `OPENBANK-${d.id}`,
    entityType: "opening_bank_balance",
    entityId: d.id,
    assetAccountId: await getBankGLAccountId(d.bankAccountId, db),
    description: `Opening bank balance #${d.id}`,
  }, db);
}

export async function journalOpeningCheque(d: {
  id: number; cityId: number; amount: number; carryingAmountPkr?: number | null; fxRateToPkr?: number | null; currencyCode: string; openingDate: Date; createdBy: number; journalVersion: number;
}, db: DbClient = prisma) {
  await journalOpeningAsset({
    ...d,
    transactionPrefix: `OPENCHEQUE-${d.id}`,
    entityType: "opening_cheque",
    entityId: d.id,
    assetAccountId: await getChequesInHandAccountId(d.cityId, db),
    description: `Opening cheque #${d.id}`,
  }, db);
}

// SALE CREATED
export async function journalSaleCreated(sale: { id: number; customerId: number; cityId: number; lotId: number; totalAmount: number; currencyCode: string; saleDate: Date; createdBy: number; }, db: DbClient = prisma) {
  const [persistedSale, existing] = await Promise.all([
    db.sale.findUnique({ where: { id: sale.id }, select: { isOpeningImport: true } }),
    db.journalEntry.findFirst({ where: { transactionId: `SALE-${sale.id}` }, select: { id: true } }),
  ]);
  if (persistedSale?.isOpeningImport || existing) return;
  const lines: JournalLine[] = [
    { accountId: await getCustomerAccountId(sale.customerId, db), debit: sale.totalAmount, credit: 0, description: `Sale #${sale.id}` },
    { accountId: await getSalesRevenueAccountId(db), debit: 0, credit: sale.totalAmount, description: `Sale #${sale.id}` },
  ];
  await createJournalEntries(`SALE-${sale.id}`, lines, { currencyCode: sale.currencyCode, entityType: "sale", entityId: sale.id, lotId: sale.lotId, cityId: sale.cityId, entryDate: sale.saleDate, createdBy: sale.createdBy }, db);
}

// PAYMENT RECEIVED (cash / bank transfer / online)
export async function journalPaymentReceived(
  p: {
    id: number; customerId: number; cityId: number; lotId: number | null;
    amount: number; currencyCode: string; paymentDate: Date; createdBy: number;
    destination?: string | null; superAdminBankAccountId?: number | null;
    bankAccountId?: number | null; paymentMethod?: string | null;
  },
  db: DbClient = prisma
) {
  let debitAccId: number;
  if (p.bankAccountId && p.paymentMethod === "bank_transfer") {
    debitAccId = await getBankGLAccountId(p.bankAccountId, db);
  } else {
    debitAccId = await getCashAccountId(p.cityId, db);
  }
  const amount = Math.abs(p.amount);
  const isReturn = p.amount < 0;
  const treasuryLine = isReturn
    ? { accountId: debitAccId, debit: 0, credit: amount, description: `Payment return #${p.id}` }
    : { accountId: debitAccId, debit: amount, credit: 0, description: `Payment #${p.id}` };
  const customerLine = isReturn
    ? { accountId: await getCustomerAccountId(p.customerId, db), debit: amount, credit: 0, description: `Payment return #${p.id}` }
    : { accountId: await getCustomerAccountId(p.customerId, db), debit: 0, credit: amount, description: `Payment #${p.id}` };

  await createJournalEntries(`PAY-${p.id}`, [treasuryLine, customerLine], { currencyCode: p.currencyCode, entityType: "payment", entityId: p.id, lotId: p.lotId, cityId: p.cityId, entryDate: p.paymentDate, createdBy: p.createdBy }, db);
}

// CHEQUE RECEIVED — stages into Cheques in Hand first, not Cash
// DR Cheques in Hand | CR AR - Customer
export async function journalChequeReceived(p: { id: number; customerId: number; cityId: number; lotId: number | null; amount: number; currencyCode: string; paymentDate: Date; createdBy: number; }, db: DbClient = prisma) {
  const amount = Math.abs(p.amount);
  const isReturn = p.amount < 0;
  const chequeAccountId = await getChequesInHandAccountId(p.cityId, db);
  const customerAccountId = await getCustomerAccountId(p.customerId, db);
  await createJournalEntries(`PAY-${p.id}`, [
    isReturn
      ? { accountId: chequeAccountId, debit: 0, credit: amount, description: `Cheque return #${p.id}` }
      : { accountId: chequeAccountId, debit: amount, credit: 0, description: `Cheque received #${p.id}` },
    isReturn
      ? { accountId: customerAccountId, debit: amount, credit: 0, description: `Cheque return #${p.id}` }
      : { accountId: customerAccountId, debit: 0, credit: amount, description: `Cheque received #${p.id}` },
  ], { currencyCode: p.currencyCode, entityType: "payment", entityId: p.id, lotId: p.lotId, cityId: p.cityId, entryDate: p.paymentDate, createdBy: p.createdBy }, db);
}

// BANK DEPOSIT CREATED
// Cash portion:   DR Bank | CR Cash in Hand
// Each cheque:    DR Bank | CR Cheques in Hand
// Cheques use separate transaction IDs so individual bounces can be reversed without affecting others.
export async function journalBankDeposit(d: {
  id: number; bankAccountId: number | null; cityId: number; cashAmount: number;
  currencyCode: string; depositDate: Date; createdBy: number;
  cheques: Array<{ paymentId: number; amount: number; }>;
  transactionKeySuffix?: string;
  transferType?: string;
}, db: DbClient = prisma) {
  const txKey = d.transactionKeySuffix ? `DEP-${d.id}-${d.transactionKeySuffix}` : `DEP-${d.id}`;
  if (d.transferType === "cheque_to_cash") {
    for (const cheque of d.cheques) {
      await createJournalEntries(`${txKey}-PAY-${cheque.paymentId}`, [
        { accountId: await getCashAccountId(d.cityId, db), debit: cheque.amount, credit: 0, description: `Cheque cashed #${cheque.paymentId}` },
        { accountId: await getChequesInHandAccountId(d.cityId, db), debit: 0, credit: cheque.amount, description: `Cheque cashed #${cheque.paymentId}` },
      ], { currencyCode: d.currencyCode, entityType: "bank_deposit", entityId: d.id, cityId: d.cityId, entryDate: d.depositDate, createdBy: d.createdBy }, db);
    }
    return;
  }
  if (!d.bankAccountId) throw new Error("Bank account is required for this transfer type");
  const bankAccId = await getBankGLAccountId(d.bankAccountId, db);
  if (d.cashAmount > 0) {
    await createJournalEntries(`${txKey}-CASH`, [
      { accountId: bankAccId, debit: d.cashAmount, credit: 0, description: `Deposit #${d.id} — cash` },
      { accountId: await getCashAccountId(d.cityId, db), debit: 0, credit: d.cashAmount, description: `Deposit #${d.id} — cash` },
    ], { currencyCode: d.currencyCode, entityType: "bank_deposit", entityId: d.id, cityId: d.cityId, entryDate: d.depositDate, createdBy: d.createdBy }, db);
  } else if (d.cashAmount < 0) {
    const withdrawal = Math.abs(d.cashAmount);
    await createJournalEntries(`${txKey}-WITHDRAWAL`, [
      { accountId: await getCashAccountId(d.cityId, db), debit: withdrawal, credit: 0, description: `Bank withdrawal #${d.id}` },
      { accountId: bankAccId, debit: 0, credit: withdrawal, description: `Bank withdrawal #${d.id}` },
    ], { currencyCode: d.currencyCode, entityType: "bank_deposit", entityId: d.id, cityId: d.cityId, entryDate: d.depositDate, createdBy: d.createdBy }, db);
  }
  for (const cheque of d.cheques) {
    await createJournalEntries(`${txKey}-PAY-${cheque.paymentId}`, [
      { accountId: bankAccId, debit: cheque.amount, credit: 0, description: `Deposit #${d.id} — cheque PAY-${cheque.paymentId}` },
      { accountId: await getChequesInHandAccountId(d.cityId, db), debit: 0, credit: cheque.amount, description: `Deposit #${d.id} — cheque PAY-${cheque.paymentId}` },
    ], { currencyCode: d.currencyCode, entityType: "bank_deposit", entityId: d.id, cityId: d.cityId, entryDate: d.depositDate, createdBy: d.createdBy }, db);
  }
}

// LOT PURCHASE (buy from company)
export async function journalLotPurchase(p: {
  id: number;
  supplierId: number;
  lotId: number;
  totalUsd: number;
  carryingRatePkr: number;
  carryingAmountPkr: number;
  recognitionDate: Date;
  journalVersion: number;
  createdBy: number;
}, db: DbClient = prisma) {
  const basis = buildLotPurchasePkrBasis({ totalUsd: p.totalUsd, carryingRatePkr: p.carryingRatePkr });
  if (!new Prisma.Decimal(basis.carryingAmountPkr).equals(p.carryingAmountPkr)) {
    throw new Error(`Lot purchase ${p.id} carrying amount does not match its foreign amount and recognition rate.`);
  }
  await createJournalEntries(lotPurchaseJournalTransactionId(p.lotId, p.id, p.journalVersion), [
    { accountId: await getInventoryAccountId(db), debit: basis.carryingAmountPkr, credit: 0, description: `Purchase Lot · USD ${basis.foreignAmountUsd} @ PKR ${basis.carryingRatePkr}` },
    { accountId: await getSupplierAccountId(p.supplierId, db), debit: 0, credit: basis.carryingAmountPkr, description: `Supplier payable · USD ${basis.foreignAmountUsd} @ PKR ${basis.carryingRatePkr}` },
  ], { currencyCode: "PKR", exchangeRate: basis.carryingRatePkr, entityType: "lot_purchase", entityId: p.id, lotId: p.lotId, entryDate: p.recognitionDate, createdBy: p.createdBy }, db);
}

// SUPPLIER PAID — settle the PKR carrying value and recognize realized FX separately.
export async function journalSupplierPaid(
  p: {
    id: number; supplierId: number; amountUsd: number;
    carryingAmountPkr: number; actualSettlementPkr: number; journalVersion: number;
    paymentDate: Date; createdBy: number;
    bankAccountId?: number | null;
    superAdminBankAccountId?: number | null;
    superAdminCashAccountId?: number | null;
    intermediaryId?: number | null;
  },
  db: DbClient = prisma
) {
  let creditAccId: number;
  if (p.intermediaryId) {
    creditAccId = await getIntermediaryAccountId(p.intermediaryId, db);
  } else if (p.superAdminCashAccountId) {
    creditAccId = await getSuperAdminCashGLAccountId(p.superAdminCashAccountId, db);
  } else if (p.superAdminBankAccountId) {
    creditAccId = await getSuperAdminBankGLAccountId(p.superAdminBankAccountId, db);
  } else if (p.bankAccountId) {
    creditAccId = await getBankGLAccountId(p.bankAccountId, db);
  } else {
    creditAccId = await getBankAccountId(db);
  }

  const amounts = buildRealizedFxPostingAmounts({
    carryingAmountPkr: p.carryingAmountPkr,
    actualSettlementPkr: p.actualSettlementPkr,
  });
  const lines: JournalLine[] = [
    { accountId: await getSupplierAccountId(p.supplierId, db), debit: amounts.liabilityDebitPkr, credit: 0, description: `Supplier liability settled · USD ${p.amountUsd}` },
    { accountId: creditAccId, debit: 0, credit: amounts.sourceCreditPkr, description: p.intermediaryId ? `Through intermediary` : `Payment to supplier` },
  ];
  if (amounts.fxLossDebitPkr > 0) {
    lines.push({ accountId: await getForeignExchangeLossAccountId(db), debit: amounts.fxLossDebitPkr, credit: 0, description: "Realized supplier FX loss" });
  }
  if (amounts.fxGainCreditPkr > 0) {
    lines.push({ accountId: await getForeignExchangeGainAccountId(db), debit: 0, credit: amounts.fxGainCreditPkr, description: "Realized supplier FX gain" });
  }
  await createJournalEntries(settlementJournalTransactionId("SUPPPAY", p.id, p.journalVersion), lines,
    { currencyCode: "PKR", entityType: "supplier_payment", entityId: p.id, entryDate: p.paymentDate, createdBy: p.createdBy }, db);
}

// LOT COST (customs, freight, transport - on agent credit or cash)
export async function journalLotCost(c: {
  id: number;
  lotId: number;
  costType: string;
  amountPkr: number;
  originalAmount: number;
  originalCurrencyCode: string;
  recognitionDate: Date;
  journalVersion: number;
  createdBy: number;
  supplierId?: number;
  agentId?: number;
  cityId?: number;
  shippingLineId?: number;
  bankAccountId?: number | null;
  superAdminBankAccountId?: number | null;
  intermediaryId?: number | null;
  paidFromCash?: boolean;
}, db: DbClient = prisma) {
  const inventoryAccountId = await getInventoryAccountId(db);
  let creditAccId: number;
  if (c.shippingLineId) { creditAccId = await getShippingLineAccountId(c.shippingLineId, db); }
  else if (c.supplierId) { creditAccId = await getSupplierAccountId(c.supplierId, db); }
  else if (c.agentId) { creditAccId = await getAgentAccountId(c.agentId, db); }
  else if (c.intermediaryId) { creditAccId = await getIntermediaryAccountId(c.intermediaryId, db); }
  else if (c.superAdminBankAccountId) { creditAccId = await getSuperAdminBankGLAccountId(c.superAdminBankAccountId, db); }
  else if (c.bankAccountId) { creditAccId = await getBankGLAccountId(c.bankAccountId, db); }
  else if (c.paidFromCash && c.cityId) { creditAccId = await getCashAccountId(c.cityId, db); }
  else if (c.paidFromCash) { creditAccId = await getOrCreateAccount("1001-GENERAL", "Cash in Hand - General", "asset", undefined, db); }
  else if (c.cityId) { creditAccId = await getCashAccountId(c.cityId, db); }
  else { creditAccId = await getOrCreateAccount("2999", "General Payable", "liability", undefined, db); }
  const source = `${c.originalCurrencyCode} ${c.originalAmount}`;
  await createJournalEntries(lotCostJournalTransactionId(c.id, c.journalVersion), [
    { accountId: inventoryAccountId, debit: c.amountPkr, credit: 0, description: `${c.costType} Lot #${c.lotId} · ${source}` },
    { accountId: creditAccId, debit: 0, credit: c.amountPkr, description: `${c.costType} · ${source}` },
  ], { currencyCode: "PKR", entityType: "lot_cost", entityId: c.id, lotId: c.lotId, cityId: c.cityId, entryDate: c.recognitionDate, createdBy: c.createdBy }, db);
}

// AGENT PAID
// Source priority: intermediary → specific bank → city cash
export async function journalAgentPaid(p: { id: number; agentId: number; cityId: number; amount: number; currencyCode: string; paymentDate: Date; createdBy: number; journalVersion?: number; bankAccountId?: number | null; superAdminBankAccountId?: number | null; intermediaryId?: number | null; superAdminCashAccountId?: number | null; }, db: DbClient = prisma) {
  let creditAccId: number;
  if (p.intermediaryId) {
    creditAccId = await getIntermediaryAccountId(p.intermediaryId, db);
  } else if (p.superAdminCashAccountId) {
    creditAccId = await getSuperAdminCashGLAccountId(p.superAdminCashAccountId, db);
  } else if (p.superAdminBankAccountId) {
    creditAccId = await getSuperAdminBankGLAccountId(p.superAdminBankAccountId, db);
  } else if (p.bankAccountId) {
    creditAccId = await getBankGLAccountId(p.bankAccountId, db);
  } else {
    creditAccId = await getCashAccountId(p.cityId, db);
  }
  const journalVersion = Number(p.journalVersion || 1);
  await createJournalEntries(agentPaymentJournalTransactionId(p.id, journalVersion), [
    { accountId: await getAgentAccountId(p.agentId, db), debit: p.amount, credit: 0, description: `Payment to agent` },
    { accountId: creditAccId, debit: 0, credit: p.amount, description: p.intermediaryId ? `Via intermediary` : p.bankAccountId ? `Bank to agent` : `Cash to agent` },
  ], { currencyCode: p.currencyCode, entityType: "agent_payment", entityId: p.id, cityId: p.cityId, entryDate: p.paymentDate, createdBy: p.createdBy }, db);
}

export function agentPaymentJournalTransactionId(id: number, journalVersion: number) {
  return journalVersion <= 1 ? `AGENTPAY-${id}` : `AGENTPAY-${id}-V${journalVersion}`;
}

// EXPENSE
// CR account depends on paidFrom: bank_account → specific bank GL, else city cash
export async function journalExpenseCreated(e: { id: number; cityId: number; lotId: number | null; amount: number; currencyCode: string; detail: string; expenseDate: Date; createdBy: number; paidFrom?: string | null; bankAccountId?: number | null; }, db: DbClient = prisma) {
  let creditAccId: number;
  if (e.paidFrom === "bank_account" && e.bankAccountId) {
    creditAccId = await getBankGLAccountId(e.bankAccountId, db);
  } else if (e.paidFrom === "cheque") {
    creditAccId = await getChequesInHandAccountId(e.cityId, db);
  } else {
    creditAccId = await getCashAccountId(e.cityId, db);
  }
  await createJournalEntries(`EXP-${e.id}`, [
    { accountId: await getExpenseAccountId("general", db), debit: e.amount, credit: 0, description: e.detail },
    { accountId: creditAccId, debit: 0, credit: e.amount, description: `Expense: ${e.detail}` },
  ], { currencyCode: e.currencyCode, entityType: "expense", entityId: e.id, lotId: e.lotId, cityId: e.cityId, entryDate: e.expenseDate, createdBy: e.createdBy }, db);
}

// WITHDRAWAL
export async function journalWithdrawal(w: { id: number; cityId: number; amount: number; currencyCode: string; date: Date; createdBy: number; sourceType?: string | null; bankAccountId?: number | null; }, db: DbClient = prisma) {
  const creditAccId = w.sourceType === "cheque"
    ? await getChequesInHandAccountId(w.cityId, db)
    : w.sourceType === "bank_account" && w.bankAccountId
      ? await getBankGLAccountId(w.bankAccountId, db)
    : await getCashAccountId(w.cityId, db);
  await createJournalEntries(`WDRAW-${w.id}`, [
    { accountId: await getOwnerWithdrawalAccountId(db), debit: w.amount, credit: 0, description: `Owner withdrawal` },
    { accountId: creditAccId, debit: 0, credit: w.amount, description: `Owner withdrawal` },
  ], { currencyCode: w.currencyCode, entityType: "withdrawal", entityId: w.id, cityId: w.cityId, entryDate: w.date, createdBy: w.createdBy }, db);
}

export async function journalCityLiabilityCharge(e: {
  id: number;
  accountId: number;
  cityId: number;
  lotId: number | null;
  amount: number;
  currencyCode: string;
  detail: string;
  entryDate: Date;
  createdBy: number;
}, db: DbClient = prisma) {
  await createJournalEntries(`CITYLIAB-${e.id}`, [
    { accountId: await getExpenseAccountId("loading_unloading", db), debit: e.amount, credit: 0, description: e.detail },
    { accountId: await getCityLiabilityAccountId(e.accountId, db), debit: 0, credit: e.amount, description: e.detail },
  ], {
    currencyCode: e.currencyCode,
    entityType: "city_liability_entry",
    entityId: e.id,
    lotId: e.lotId,
    cityId: e.cityId,
    entryDate: e.entryDate,
    createdBy: e.createdBy,
  }, db);
}

export async function journalCityLiabilityPayment(e: {
  id: number;
  accountId: number;
  cityId: number;
  amount: number;
  currencyCode: string;
  detail: string;
  entryDate: Date;
  createdBy: number;
  paymentSource?: string | null;
  bankAccountId?: number | null;
}, db: DbClient = prisma) {
  const creditAccId = e.paymentSource === "cheque"
    ? await getChequesInHandAccountId(e.cityId, db)
    : e.paymentSource === "bank_account" && e.bankAccountId
      ? await getBankGLAccountId(e.bankAccountId, db)
      : await getCashAccountId(e.cityId, db);
  await createJournalEntries(`CITYLIAB-${e.id}`, [
    { accountId: await getCityLiabilityAccountId(e.accountId, db), debit: e.amount, credit: 0, description: e.detail },
    { accountId: creditAccId, debit: 0, credit: e.amount, description: e.detail },
  ], {
    currencyCode: e.currencyCode,
    entityType: "city_liability_entry",
    entityId: e.id,
    cityId: e.cityId,
    entryDate: e.entryDate,
    createdBy: e.createdBy,
  }, db);
}

// HAJI TRANSFER
// sourceType "cheque" → CR Cheques in Hand; "bank_transfer" → CR Bank GL; default → CR Cash in Hand
// Afghanistan settlementDestination "intermediary" → DR Intermediary asset
// Afghanistan settlementDestination "super_admin_cash" → DR Super Admin Cash GL
// default / Pakistan → DR Haji equity account
export async function journalHajiTransfer(h: {
  id: number;
  cityId: number;
  lotId?: number | null;
  amount: number;
  currencyCode: string;
  date: Date;
  createdBy: number;
  sourceType?: string | null;
  bankAccountId?: number | null;
  settlementDestination?: string | null;
  intermediaryId?: number | null;
  superAdminCashAccountId?: number | null;
  superAdminBankAccountId?: number | null;
}, db: DbClient = prisma) {
  let creditAccId: number;
  if (h.sourceType === "cheque") {
    creditAccId = await getChequesInHandAccountId(h.cityId, db);
  } else if (h.sourceType === "bank_transfer" && h.bankAccountId) {
    creditAccId = await getBankGLAccountId(h.bankAccountId, db);
  } else {
    creditAccId = await getCashAccountId(h.cityId, db);
  }

  let debitAccId: number;
  if (h.settlementDestination === "intermediary" && h.intermediaryId) {
    debitAccId = await getIntermediaryAccountId(h.intermediaryId, db);
  } else if (h.settlementDestination === "super_admin_cash" && h.superAdminCashAccountId) {
    debitAccId = await getSuperAdminCashGLAccountId(h.superAdminCashAccountId, db);
  } else if (h.superAdminBankAccountId) {
    debitAccId = await getSuperAdminBankGLAccountId(h.superAdminBankAccountId, db);
  } else {
    debitAccId = await getHajiAccountId(db);
  }

  const amount = Math.abs(h.amount);
  const isReturn = h.amount < 0;
  await createJournalEntries(`HAJI-${h.id}`, [
    isReturn
      ? { accountId: debitAccId, debit: 0, credit: amount, description: `Haji transfer return` }
      : { accountId: debitAccId, debit: amount, credit: 0, description: `Haji transfer` },
    isReturn
      ? { accountId: creditAccId, debit: amount, credit: 0, description: `Haji transfer return` }
      : { accountId: creditAccId, debit: 0, credit: amount, description: `Haji transfer` },
  ], {
    currencyCode: h.currencyCode,
    entityType: "haji_transfer",
    entityId: h.id,
    lotId: h.lotId ?? null,
    cityId: h.cityId,
    entryDate: h.date,
    createdBy: h.createdBy,
  }, db);
}

// INTERMEDIARY (HAWALA) ACCOUNT
export async function getIntermediaryAccountId(intermediaryId: number, db: DbClient = prisma): Promise<number> {
  const party = await db.intermediary.findUnique({ where: { id: intermediaryId }, select: { name: true } });
  return getOrCreateAccount(`1060-H${intermediaryId}`, `Intermediary - ${party?.name || intermediaryId}`, "asset", undefined, db);
}

export async function getIntermediaryFxClearingAccountId(intermediaryId: number, db: DbClient = prisma): Promise<number> {
  const party = await db.intermediary.findUnique({ where: { id: intermediaryId }, select: { name: true } });
  return getOrCreateAccount(`1061-HFX${intermediaryId}`, `Intermediary FX Clearing - ${party?.name || intermediaryId}`, "asset", undefined, db);
}

// INTERMEDIARY DEPOSIT — money sent TO the intermediary
// city_cash:    DR Intermediary Asset | CR Cash in Hand (city)
// bank_account: DR Intermediary Asset | CR Bank GL
export async function journalIntermediaryDeposit(d: {
  id: number; intermediaryId: number; amount: number; currencyCode: string;
  depositDate: Date; createdBy: number;
  sourceType: string; cityId?: number | null; bankAccountId?: number | null;
  superAdminBankAccountId?: number | null; superAdminCashAccountId?: number | null;
  journalVersion?: number;
}, db: DbClient = prisma) {
  let creditAccId: number;
  if (d.sourceType === "super_admin_cash" && d.superAdminCashAccountId) {
    creditAccId = await getSuperAdminCashGLAccountId(d.superAdminCashAccountId, db);
  } else if (d.sourceType === "super_admin_bank_account" && d.superAdminBankAccountId) {
    creditAccId = await getSuperAdminBankGLAccountId(d.superAdminBankAccountId, db);
  } else if (d.sourceType === "bank_account" && d.bankAccountId) {
    creditAccId = await getBankGLAccountId(d.bankAccountId, db);
  } else if (d.cityId) {
    creditAccId = await getCashAccountId(d.cityId, db);
  } else {
    creditAccId = await getOrCreateAccount("1050", "Bank Account (USD)", "asset", undefined, db);
  }
  await createJournalEntries(intermediaryDepositJournalTransactionId(d.id, d.journalVersion || 1), [
    { accountId: await getIntermediaryAccountId(d.intermediaryId, db), debit: d.amount, credit: 0, description: `Deposit to intermediary #${d.intermediaryId}` },
    { accountId: creditAccId, debit: 0, credit: d.amount, description: `Deposit to intermediary #${d.intermediaryId}` },
  ], { currencyCode: d.currencyCode, entityType: "intermediary_deposit", entityId: d.id, cityId: d.cityId, entryDate: d.depositDate, createdBy: d.createdBy }, db);
}

export function intermediaryDepositJournalTransactionId(id: number, journalVersion: number) {
  return journalVersion <= 1 ? `INTDEP-${id}` : `INTDEP-${id}-V${journalVersion}`;
}

async function getSuperAdminLiabilitySourceAccountId(source: {
  sourceType: string;
  superAdminBankAccountId?: number | null;
  superAdminCashAccountId?: number | null;
  intermediaryId?: number | null;
  bankAccountId?: number | null;
  cityId?: number | null;
}, db: DbClient) {
  if (source.sourceType === "super_admin_bank" && source.superAdminBankAccountId) return getSuperAdminBankGLAccountId(source.superAdminBankAccountId, db);
  if (source.sourceType === "super_admin_cash" && source.superAdminCashAccountId) return getSuperAdminCashGLAccountId(source.superAdminCashAccountId, db);
  if (source.sourceType === "intermediary" && source.intermediaryId) return getIntermediaryAccountId(source.intermediaryId, db);
  if (source.sourceType === "city_bank" && source.bankAccountId) return getBankGLAccountId(source.bankAccountId, db);
  if (source.sourceType === "city_cash" && source.cityId) return getCashAccountId(source.cityId, db);
  throw new Error("A valid liability funding source is required");
}

export async function journalSuperAdminLiabilityEntry(entry: {
  id: number;
  entryType: "loan_received" | "liability_incurred" | "payment";
  controlAccountId: number;
  counterAccountId?: number | null;
  pkrAmount: number;
  carryingAmountPkr?: number | null;
  actualSettlementPkr?: number | null;
  entryDate: Date;
  createdBy: number;
  sourceType?: string | null;
  superAdminBankAccountId?: number | null;
  superAdminCashAccountId?: number | null;
  intermediaryId?: number | null;
  bankAccountId?: number | null;
  cityId?: number | null;
  description: string;
}, db: DbClient = prisma) {
  let lines: Array<{ accountId: number; debit: number; credit: number; description: string }>;
  if (entry.entryType === "liability_incurred") {
    if (!entry.counterAccountId) throw new Error("A counterpart account is required for a liability charge");
    lines = [
      { accountId: entry.counterAccountId, debit: entry.pkrAmount, credit: 0, description: entry.description },
      { accountId: entry.controlAccountId, debit: 0, credit: entry.pkrAmount, description: entry.description },
    ];
  } else {
    const sourceAccountId = await getSuperAdminLiabilitySourceAccountId({
      sourceType: entry.sourceType || "",
      superAdminBankAccountId: entry.superAdminBankAccountId,
      superAdminCashAccountId: entry.superAdminCashAccountId,
      intermediaryId: entry.intermediaryId,
      bankAccountId: entry.bankAccountId,
      cityId: entry.cityId,
    }, db);
    if (entry.entryType === "loan_received") {
      lines = [
        { accountId: sourceAccountId, debit: entry.pkrAmount, credit: 0, description: entry.description },
        { accountId: entry.controlAccountId, debit: 0, credit: entry.pkrAmount, description: entry.description },
      ];
    } else {
      const amounts = buildRealizedFxPostingAmounts({
        carryingAmountPkr: entry.carryingAmountPkr ?? entry.pkrAmount,
        actualSettlementPkr: entry.actualSettlementPkr ?? entry.pkrAmount,
      });
      lines = [
        { accountId: entry.controlAccountId, debit: amounts.liabilityDebitPkr, credit: 0, description: entry.description },
        { accountId: sourceAccountId, debit: 0, credit: amounts.sourceCreditPkr, description: entry.description },
      ];
      if (amounts.fxLossDebitPkr > 0) {
        lines.push({ accountId: await getForeignExchangeLossAccountId(db), debit: amounts.fxLossDebitPkr, credit: 0, description: `${entry.description} — realized FX loss` });
      }
      if (amounts.fxGainCreditPkr > 0) {
        lines.push({ accountId: await getForeignExchangeGainAccountId(db), debit: 0, credit: amounts.fxGainCreditPkr, description: `${entry.description} — realized FX gain` });
      }
    }
  }
  await createJournalEntries(`SALIAB-${entry.id}`, lines, {
    currencyCode: "PKR",
    entityType: "super_admin_liability_entry",
    entityId: entry.id,
    entryDate: entry.entryDate,
    createdBy: entry.createdBy,
  }, db);
}

export async function journalSuperAdminAccountTransfer(transfer: {
  id: number;
  transferType: "same_currency" | "exchange";
  sourceAccountId: number;
  destinationAccountId: number;
  fromCurrencyCode: string;
  toCurrencyCode: string;
  fromAmount: number;
  toAmount: number;
  transferDate: Date;
  createdBy: number;
}, db: DbClient = prisma) {
  const [source, destination] = await Promise.all([
    db.superAdminBankAccount.findUnique({ where: { id: transfer.sourceAccountId }, select: { accountKind: true } }),
    db.superAdminBankAccount.findUnique({ where: { id: transfer.destinationAccountId }, select: { accountKind: true } }),
  ]);
  if (!source || !destination) throw new Error("Transfer accounts are required");
  const sourceGlId = source.accountKind === "cash"
    ? await getSuperAdminCashGLAccountId(transfer.sourceAccountId, db)
    : await getSuperAdminBankGLAccountId(transfer.sourceAccountId, db);
  const destinationGlId = destination.accountKind === "cash"
    ? await getSuperAdminCashGLAccountId(transfer.destinationAccountId, db)
    : await getSuperAdminBankGLAccountId(transfer.destinationAccountId, db);
  if (transfer.transferType === "same_currency") {
    await createJournalEntries(`SATRANS-${transfer.id}`, [
      { accountId: destinationGlId, debit: transfer.toAmount, credit: 0, description: "Superadmin account transfer received" },
      { accountId: sourceGlId, debit: 0, credit: transfer.fromAmount, description: "Superadmin account transfer sent" },
    ], { currencyCode: transfer.fromCurrencyCode, entityType: "super_admin_account_transfer", entityId: transfer.id, entryDate: transfer.transferDate, createdBy: transfer.createdBy }, db);
    return;
  }
  const clearingId = await getOrCreateAccount("1062-SAFX", "Superadmin FX Transfer Clearing", "asset", undefined, db);
  await createJournalEntries(`SATRANS-OUT-${transfer.id}`, [
    { accountId: clearingId, debit: transfer.fromAmount, credit: 0, description: "Superadmin exchange transfer out" },
    { accountId: sourceGlId, debit: 0, credit: transfer.fromAmount, description: "Superadmin exchange transfer out" },
  ], { currencyCode: transfer.fromCurrencyCode, entityType: "super_admin_account_transfer", entityId: transfer.id, entryDate: transfer.transferDate, createdBy: transfer.createdBy }, db);
  await createJournalEntries(`SATRANS-IN-${transfer.id}`, [
    { accountId: destinationGlId, debit: transfer.toAmount, credit: 0, description: "Superadmin exchange transfer in" },
    { accountId: clearingId, debit: 0, credit: transfer.toAmount, description: "Superadmin exchange transfer in" },
  ], { currencyCode: transfer.toCurrencyCode, entityType: "super_admin_account_transfer", entityId: transfer.id, entryDate: transfer.transferDate, createdBy: transfer.createdBy }, db);
}

export async function journalHajiCashReceipt(r: {
  id: number;
  superAdminCashAccountId: number;
  accountKind: "bank" | "cash";
  intermediaryId: number;
  amount: number;
  currencyCode: string;
  receiptDate: Date;
  createdBy: number;
}, db: DbClient = prisma) {
  const destinationAccountId = r.accountKind === "cash"
    ? await getSuperAdminCashGLAccountId(r.superAdminCashAccountId, db)
    : await getSuperAdminBankGLAccountId(r.superAdminCashAccountId, db);
  await createJournalEntries(`HAJIREC-${r.id}`, [
    { accountId: destinationAccountId, debit: r.amount, credit: 0, description: `Receipt from intermediary #${r.intermediaryId}` },
    { accountId: await getIntermediaryAccountId(r.intermediaryId, db), debit: 0, credit: r.amount, description: `Receipt from intermediary #${r.intermediaryId}` },
  ], {
    currencyCode: r.currencyCode,
    entityType: "haji_cash_receipt",
    entityId: r.id,
    entryDate: r.receiptDate,
    createdBy: r.createdBy,
  }, db);
}

// INTERMEDIARY FX EXCHANGE
// OUT leg (from currency): DR FX clearing | CR Intermediary
// IN leg (to currency):    DR Intermediary | CR FX clearing
export async function journalIntermediaryExchange(e: {
  id: number;
  intermediaryId: number;
  exchangeDate: Date;
  fromCurrencyCode: string;
  fromAmount: number;
  toCurrencyCode: string;
  toAmount: number;
  createdBy: number;
}, db: DbClient = prisma) {
  const intermediaryAccountId = await getIntermediaryAccountId(e.intermediaryId, db);
  const fxClearingAccountId = await getIntermediaryFxClearingAccountId(e.intermediaryId, db);

  await createJournalEntries(`INTFX-OUT-${e.id}`, [
    { accountId: fxClearingAccountId, debit: e.fromAmount, credit: 0, description: `FX OUT #${e.id}` },
    { accountId: intermediaryAccountId, debit: 0, credit: e.fromAmount, description: `FX OUT #${e.id}` },
  ], {
    currencyCode: e.fromCurrencyCode,
    entityType: "intermediary_exchange",
    entityId: e.id,
    entryDate: e.exchangeDate,
    createdBy: e.createdBy,
  }, db);

  await createJournalEntries(`INTFX-IN-${e.id}`, [
    { accountId: intermediaryAccountId, debit: e.toAmount, credit: 0, description: `FX IN #${e.id}` },
    { accountId: fxClearingAccountId, debit: 0, credit: e.toAmount, description: `FX IN #${e.id}` },
  ], {
    currencyCode: e.toCurrencyCode,
    entityType: "intermediary_exchange",
    entityId: e.id,
    entryDate: e.exchangeDate,
    createdBy: e.createdBy,
  }, db);
}

// OPENING LIABILITY — pre-go-live payables flow into party GL accounts
export async function journalOpeningLiability(
  p: {
    id: number;
    liabilityType: string;
    partyId: number;
    amount: number;
    balanceSide: "payable" | "receivable";
    carryingAmountPkr?: number | null;
    fxRateToPkr?: number | null;
    currencyCode: string;
    openingDate: Date;
    createdBy: number;
    journalVersion: number;
  },
  db: DbClient = prisma
) {
  const carrying = resolveOpeningCarryingAmount(p);
  const amount = Math.abs(carrying.carryingAmountPkr);
  let payableAccountId: number;
  let receivableAccountId: number;
  if (p.liabilityType === "supplier") {
    payableAccountId = await getSupplierAccountId(p.partyId, db);
    receivableAccountId = await getOrCreateAccount(`1250-S${p.partyId}`, `Advance to Supplier #${p.partyId}`, "asset", undefined, db);
  } else if (p.liabilityType === "shipping_line") {
    payableAccountId = await getShippingLineAccountId(p.partyId, db);
    receivableAccountId = await getOrCreateAccount(`1260-SL${p.partyId}`, `Advance to Shipping Line #${p.partyId}`, "asset", undefined, db);
  } else if (p.liabilityType === "agent") {
    payableAccountId = await getAgentAccountId(p.partyId, db);
    receivableAccountId = await getOrCreateAccount(`1270-A${p.partyId}`, `Advance to Agent #${p.partyId}`, "asset", undefined, db);
  } else if (p.liabilityType === "intermediary") {
    payableAccountId = await getOrCreateAccount(`2350-I${p.partyId}`, `Payable to Intermediary #${p.partyId}`, "liability", undefined, db);
    receivableAccountId = await getIntermediaryAccountId(p.partyId, db);
  } else throw new Error(`Unsupported opening liability type: ${p.liabilityType}`);

  const isReceivable = p.balanceSide === "receivable";
  const receivableDescription = p.liabilityType === "intermediary"
    ? "Opening intermediary receivable"
    : "Opening party receivable/advance";

  await createJournalEntries(`OPENLIAB-${p.id}-V${p.journalVersion}`, [
    isReceivable
      ? { accountId: receivableAccountId, debit: amount, credit: 0, description: receivableDescription }
      : { accountId: await getOpeningBalanceAccountId(db), debit: amount, credit: 0, description: "Opening party payable" },
    isReceivable
      ? { accountId: await getOpeningBalanceAccountId(db), debit: 0, credit: amount, description: receivableDescription }
      : { accountId: payableAccountId, debit: 0, credit: amount, description: "Opening party payable" },
  ], {
    currencyCode: "PKR",
    exchangeRate: carrying.fxRateToPkr,
    entityType: "opening_liability",
    entityId: p.id,
    entryDate: p.openingDate,
    createdBy: p.createdBy,
  }, db);
}

export async function journalOpeningCityLiability(
  p: {
    id: number;
    accountId: number;
    cityId: number;
    amount: number;
    carryingAmountPkr?: number | null;
    fxRateToPkr?: number | null;
    currencyCode: string;
    openingDate: Date;
    createdBy: number;
    journalVersion: number;
  },
  db: DbClient = prisma
) {
  const carrying = resolveOpeningCarryingAmount(p);
  const amount = Math.abs(carrying.carryingAmountPkr);
  await createJournalEntries(`OPENCITYLIAB-${p.id}-V${p.journalVersion}`, [
    { accountId: await getOpeningBalanceAccountId(db), debit: amount, credit: 0, description: "Opening city liability" },
    { accountId: await getCityLiabilityAccountId(p.accountId, db), debit: 0, credit: amount, description: "Opening city liability" },
  ], {
    currencyCode: "PKR",
    exchangeRate: carrying.fxRateToPkr,
    entityType: "opening_city_liability",
    entityId: p.id,
    cityId: p.cityId,
    entryDate: p.openingDate,
    createdBy: p.createdBy,
  }, db);
}

export async function journalOpeningHajiBalance(
  p: {
    id: number;
    cityId: number;
    amount: number;
    balanceSide: "payable" | "receivable";
    carryingAmountPkr?: number | null;
    fxRateToPkr?: number | null;
    currencyCode: string;
    openingDate: Date;
    createdBy: number;
    journalVersion: number;
  },
  db: DbClient = prisma
) {
  const carrying = resolveOpeningCarryingAmount(p);
  const amount = Math.abs(carrying.carryingAmountPkr);
  const isReceivable = p.balanceSide === "receivable";
  await createJournalEntries(`OPENHAJI-${p.id}-V${p.journalVersion}`, [
    isReceivable
      ? { accountId: await getHajiReceivableAccountId(p.cityId, db), debit: amount, credit: 0, description: "Opening due from Haji" }
      : { accountId: await getOpeningBalanceAccountId(db), debit: amount, credit: 0, description: "Opening owed to Haji" },
    isReceivable
      ? { accountId: await getOpeningBalanceAccountId(db), debit: 0, credit: amount, description: "Opening due from Haji" }
      : { accountId: await getHajiPayableAccountId(p.cityId, db), debit: 0, credit: amount, description: "Opening owed to Haji" },
  ], {
    currencyCode: "PKR",
    exchangeRate: carrying.fxRateToPkr,
    entityType: "opening_haji_balance",
    entityId: p.id,
    cityId: p.cityId,
    entryDate: p.openingDate,
    createdBy: p.createdBy,
  }, db);
}

export async function journalOpeningInventoryValuation(p: {
  id: number;
  lotId: number;
  productId: number;
  totalValuePkr: number;
  openingDate: Date;
  createdBy: number;
  journalVersion: number;
}, db: DbClient = prisma) {
  const amount = roundMoney(p.totalValuePkr);
  if (amount <= 0) throw new Error("Opening inventory value must be greater than zero.");
  await createJournalEntries(`OPENINV-${p.id}-V${p.journalVersion}`, [
    { accountId: await getInventoryAccountId(db), debit: amount, credit: 0, description: `Opening inventory valuation · lot ${p.lotId} · product ${p.productId}` },
    { accountId: await getOpeningBalanceAccountId(db), debit: 0, credit: amount, description: `Opening inventory valuation · lot ${p.lotId} · product ${p.productId}` },
  ], {
    currencyCode: "PKR",
    entityType: "opening_inventory_valuation",
    entityId: p.id,
    lotId: p.lotId,
    entryDate: p.openingDate,
    createdBy: p.createdBy,
  }, db);
}

export async function journalOpeningSuperAdminAccountBalance(p: {
  id: number;
  accountId: number;
  accountKind: "bank" | "cash";
  amount: number;
  carryingAmountPkr: number;
  fxRateToPkr?: number | null;
  currencyCode: string;
  openingDate: Date;
  createdBy: number;
  journalVersion: number;
}, db: DbClient = prisma) {
  const carrying = resolveOpeningCarryingAmount(p);
  await journalOpeningAsset({
    transactionPrefix: `OPENSA-${p.id}`,
    entityType: "opening_super_admin_account_balance",
    entityId: p.id,
    cityId: 0,
    amount: p.amount,
    carryingAmountPkr: carrying.carryingAmountPkr,
    fxRateToPkr: carrying.fxRateToPkr,
    currencyCode: p.currencyCode,
    openingDate: p.openingDate,
    createdBy: p.createdBy,
    journalVersion: p.journalVersion,
    assetAccountId: p.accountKind === "cash"
      ? await getSuperAdminCashGLAccountId(p.accountId, db)
      : await getSuperAdminBankGLAccountId(p.accountId, db),
    description: `Opening superadmin ${p.accountKind} balance #${p.id}`,
  }, db);
}

export async function journalOpeningEquityAllocation(p: {
  id: number;
  equityType: "manager_capital" | "retained_earnings" | "other";
  label: string;
  amountPkr: number;
  openingDate: Date;
  createdBy: number;
  journalVersion: number;
}, db: DbClient = prisma) {
  const amount = Math.abs(roundMoney(p.amountPkr));
  if (amount === 0) throw new Error("Opening equity amount must be non-zero.");
  const account = p.equityType === "manager_capital"
    ? await getOrCreateAccount("3902", "Opening Manager Capital", "equity", undefined, db)
    : p.equityType === "retained_earnings"
      ? await getOrCreateAccount("3903", "Opening Retained Earnings", "equity", undefined, db)
      : await getOrCreateAccount("3904", "Other Opening Equity", "equity", undefined, db);
  const positiveEquity = p.amountPkr > 0;
  await createJournalEntries(`OPENEQ-${p.id}-V${p.journalVersion}`, [
    positiveEquity
      ? { accountId: await getOpeningBalanceAccountId(db), debit: amount, credit: 0, description: p.label }
      : { accountId: account, debit: amount, credit: 0, description: p.label },
    positiveEquity
      ? { accountId: account, debit: 0, credit: amount, description: p.label }
      : { accountId: await getOpeningBalanceAccountId(db), debit: 0, credit: amount, description: p.label },
  ], {
    currencyCode: "PKR",
    entityType: "opening_equity_allocation",
    entityId: p.id,
    entryDate: p.openingDate,
    createdBy: p.createdBy,
  }, db);
}

// SUPER ADMIN PERSONAL / HOME EXPENSE — debited from SA bank GL
export async function journalSuperAdminPersonalExpense(
  e: {
    id: number;
    amount: number;
    currencyCode: string;
    detail: string;
    expenseDate: Date;
    createdBy: number;
    bankAccountId: number;
    journalVersion: number;
  },
  db: DbClient = prisma
) {
  await createJournalEntries(personalExpenseJournalTransactionId(e.id, e.journalVersion), [
    { accountId: await getExpenseAccountId("office", db), debit: e.amount, credit: 0, description: e.detail },
    { accountId: await getSuperAdminBankGLAccountId(e.bankAccountId, db), debit: 0, credit: e.amount, description: e.detail },
  ], {
    currencyCode: e.currencyCode,
    entityType: "super_admin_personal_expense",
    entityId: e.id,
    entryDate: e.expenseDate,
    createdBy: e.createdBy,
  }, db);
}

// SHIPPING LINE PAID — settle the PKR carrying value and recognize realized FX separately.
// Source priority: intermediary → specific bank → generic bank
export async function journalShippingLinePayment(p: { id: number; shippingLineId: number; amountUsd: number; carryingAmountPkr: number; actualSettlementPkr: number; journalVersion: number; paymentDate: Date; createdBy: number; bankAccountId?: number | null; superAdminBankAccountId?: number | null; intermediaryId?: number | null; superAdminCashAccountId?: number | null; }, db: DbClient = prisma) {
  let creditAccId: number;
  if (p.intermediaryId) {
    creditAccId = await getIntermediaryAccountId(p.intermediaryId, db);
  } else if (p.superAdminCashAccountId) {
    creditAccId = await getSuperAdminCashGLAccountId(p.superAdminCashAccountId, db);
  } else if (p.superAdminBankAccountId) {
    creditAccId = await getSuperAdminBankGLAccountId(p.superAdminBankAccountId, db);
  } else if (p.bankAccountId) {
    creditAccId = await getBankGLAccountId(p.bankAccountId, db);
  } else {
    creditAccId = await getBankAccountId(db);
  }
  const amounts = buildRealizedFxPostingAmounts({ carryingAmountPkr: p.carryingAmountPkr, actualSettlementPkr: p.actualSettlementPkr });
  const lines: JournalLine[] = [
    { accountId: await getShippingLineAccountId(p.shippingLineId, db), debit: amounts.liabilityDebitPkr, credit: 0, description: `Shipping liability settled · USD ${p.amountUsd}` },
    { accountId: creditAccId, debit: 0, credit: amounts.sourceCreditPkr, description: p.intermediaryId ? `Via intermediary` : `Payment to shipping line` },
  ];
  if (amounts.fxLossDebitPkr > 0) {
    lines.push({ accountId: await getForeignExchangeLossAccountId(db), debit: amounts.fxLossDebitPkr, credit: 0, description: "Realized shipping FX loss" });
  }
  if (amounts.fxGainCreditPkr > 0) {
    lines.push({ accountId: await getForeignExchangeGainAccountId(db), debit: 0, credit: amounts.fxGainCreditPkr, description: "Realized shipping FX gain" });
  }
  await createJournalEntries(settlementJournalTransactionId("SLPAY", p.id, p.journalVersion), lines,
    { currencyCode: "PKR", entityType: "shipping_line_payment", entityId: p.id, entryDate: p.paymentDate, createdBy: p.createdBy }, db);
}

// COGS AT POINT OF SALE
// Computes landed cost per carton from lot data and journals:
// DR Cost of Goods Sold | CR Inventory
export async function calculateSaleCogsPkr(params: {
  saleId: number;
  lotId: number;
  totalQtySold: number;
  usdPkrRateOverride?: number;
}, db: DbClient = prisma): Promise<number> {
  const { saleId, lotId, totalQtySold, usdPkrRateOverride } = params;
  const [lot, costs, lotProducts, saleItems, openingValuations] = await Promise.all([
    db.lot.findUnique({ where: { id: lotId }, select: { pkrExchangeRate: true, countryId: true, lotDate: true } }),
    db.lotCost.findMany({
      where: { lotId },
      select: { amount: true, currencyCode: true, exchangeRate: true, costType: true },
    }),
    db.lotProduct.findMany({
      where: { lotId },
      select: { productId: true, totalQty: true, product: { select: { unitOfMeasure: true } } },
    }),
    db.saleItem.findMany({
      where: { saleId, lotId },
      select: { productId: true, qty: true, product: { select: { unitOfMeasure: true } } },
    }),
    db.openingInventoryValuation.findMany({
      where: { lotId },
      select: { productId: true, unitCostPkr: true },
    }),
  ]);

  if (openingValuations.length > 0) {
    const unitCostByProduct = new Map(openingValuations.map((row) => [row.productId, Number(row.unitCostPkr)]));
    const missingProductIds = saleItems
      .filter((item) => !unitCostByProduct.has(item.productId))
      .map((item) => item.productId);
    if (missingProductIds.length > 0) {
      throw new Error(`Opening inventory valuation is incomplete for lot ${lotId}; missing product(s): ${Array.from(new Set(missingProductIds)).join(", ")}`);
    }
    return roundMoney(saleItems.reduce((sum, item) => sum + Number(item.qty || 0) * Number(unitCostByProduct.get(item.productId) || 0), 0));
  }

  const usdPkrRate = Number(usdPkrRateOverride || 0) > 0
    ? Number(usdPkrRateOverride)
    : Number(lot?.pkrExchangeRate || 0) > 0
    ? Number(lot?.pkrExchangeRate || 0)
    : Number(lot ? await getCountryFallbackRateToPkr({ countryId: lot.countryId, fromCurrencyCode: "USD", asOf: lot.lotDate }, db) : 0);
  if (totalQtySold === 0 || usdPkrRate <= 0) return 0;

  const mtProductIds = lotProducts
    .filter((lp) => lp.product.unitOfMeasure !== "PCS")
    .map((lp) => lp.productId);
  const pcsSaleItems = saleItems.filter((item) => item.product.unitOfMeasure === "PCS");
  const mtQtySold = saleItems
    .filter((item) => item.product.unitOfMeasure !== "PCS")
    .reduce((sum, item) => sum + Number(item.qty || 0), 0);

  let cogsAmount = 0;
  if (mtQtySold > 0) {
    const mtTotalQty = lotProducts
      .filter((lp) => lp.product.unitOfMeasure !== "PCS")
      .reduce((sum, lp) => sum + Number(lp.totalQty || 0), 0);
    const mtPurchases = mtProductIds.length
      ? await db.lotPurchase.aggregate({
          where: { lotId, productId: { in: mtProductIds } },
          _sum: { totalPriceUsd: true },
        })
      : null;
    if (mtTotalQty > 0) {
      const landed = computeLotLandedCostPkr({
        totalPurchaseUsd: Number(mtPurchases?._sum.totalPriceUsd || 0),
        totalCartons: mtTotalQty,
        lotCosts: costs,
        lotExpensesByCurrency: {},
        usdPkrRate,
      });
      if (landed.landedCostPerCartonPkr > 0) {
        cogsAmount += mtQtySold * landed.landedCostPerCartonPkr;
      }
    }
  }

  for (const item of pcsSaleItems) {
    const pcsPurchases = await db.lotPurchase.aggregate({
      where: { lotId, productId: item.productId },
      _sum: { qty: true, totalPriceUsd: true },
    });
    const purchasedPieces = Number(pcsPurchases._sum.qty || 0);
    if (purchasedPieces <= 0) continue;
    const averageUsdPerPiece = Number(pcsPurchases._sum.totalPriceUsd || 0) / purchasedPieces;
    cogsAmount += Number(item.qty || 0) * averageUsdPerPiece * usdPkrRate;
  }

  cogsAmount = Math.round(cogsAmount * 100) / 100;
  return cogsAmount > 0 ? cogsAmount : 0;
}

export async function journalSaleCOGS(params: {
  saleId: number; lotId: number; totalQtySold: number;
  saleDate: Date; cityId: number; createdBy: number;
}, db: DbClient = prisma) {
  return journalSaleCOGSForLots({
    saleId: params.saleId,
    allocations: [{ lotId: params.lotId, totalQtySold: params.totalQtySold }],
    saleDate: params.saleDate,
    cityId: params.cityId,
    createdBy: params.createdBy,
  }, db);
}

export async function journalSaleCOGSForLots(params: {
  saleId: number;
  allocations: Array<{ lotId: number; totalQtySold: number }>;
  saleDate: Date;
  cityId: number;
  createdBy: number;
}, db: DbClient = prisma) {
  const { saleId, allocations, saleDate, cityId, createdBy } = params;
  const sale = await db.sale.findUnique({ where: { id: saleId }, select: { isOpeningImport: true } });
  if (sale?.isOpeningImport) return;

  const costs = await Promise.all(allocations.map(async ({ lotId, totalQtySold }) => ({
    lotId,
    amount: await calculateSaleCogsPkr({ saleId, lotId, totalQtySold }, db),
  })));
  const postable = costs.filter(({ amount }) => amount > 0);
  if (!postable.length) return;

  const [cogsAccountId, inventoryAccountId] = await Promise.all([
    getCOGSAccountId(db),
    getInventoryAccountId(db),
  ]);
  const lines: JournalLine[] = postable.flatMap(({ lotId, amount }) => [
    { accountId: cogsAccountId, debit: amount, credit: 0, description: `COGS — Sale #${saleId} · Lot #${lotId}`, lotId },
    { accountId: inventoryAccountId, debit: 0, credit: amount, description: `Inventory reduction — Sale #${saleId} · Lot #${lotId}`, lotId },
  ]);

  await createJournalEntries(`COGS-${saleId}`, lines, {
    currencyCode: "PKR",
    entityType: "sale",
    entityId: saleId,
    cityId,
    entryDate: saleDate,
    createdBy,
  }, db);
}

export async function journalHistoricalOpeningStockAdjustment(params: {
  saleId: number; lotId: number; totalQtySold: number;
  saleDate: Date; cityId: number; createdBy: number;
}, db: DbClient = prisma): Promise<number> {
  const { saleId, lotId, saleDate, cityId, createdBy } = params;
  const transactionId = historicalOpeningAdjustmentTransactionId(saleId);
  const [sale, existing] = await Promise.all([
    db.sale.findUnique({ where: { id: saleId }, select: { isOpeningImport: true } }),
    db.journalEntry.findFirst({ where: { transactionId, lotId }, select: { id: true } }),
  ]);
  if (!sale?.isOpeningImport || existing) return 0;

  const adjustmentAmount = await calculateSaleCogsPkr(params, db);
  if (adjustmentAmount <= 0) return 0;

  await createJournalEntries(transactionId, [
    { accountId: await getHistoricalStockAdjustmentAccountId(db), debit: adjustmentAmount, credit: 0, description: `Historical stock adjustment — Opening Sale #${saleId}` },
    { accountId: await getInventoryAccountId(db), debit: 0, credit: adjustmentAmount, description: `Historical inventory reduction — Opening Sale #${saleId}` },
  ], { currencyCode: "PKR", entityType: "historical_sale_opening_adjustment", entityId: saleId, lotId, cityId, entryDate: saleDate, createdBy }, db);
  return adjustmentAmount;
}

// REVERSE (for cancellations)
export async function reverseJournalEntries(transactionId: string, createdBy: number, db: DbClient = prisma, entryDate?: Date) {
  const reverseWithinTransaction = async (tx: DbClient) => {
    await (tx as any).$executeRawUnsafe(
      "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
      `journal-reversal:${transactionId}`,
    );
    const reversalTransactionId = `REV-${transactionId}`;
    const existingReversal = await tx.journalEntry.findMany({ where: { transactionId: reversalTransactionId }, take: 1 });
    if (existingReversal.length > 0) return;
    const entries = await tx.journalEntry.findMany({ where: { transactionId } });
    if (entries.length === 0) return;
    const reversalDate = entryDate || new Date();
    await assertAccountingDateOpen(reversalDate, tx);
    await tx.journalEntry.createMany({
      data: entries.map((e) => ({
        transactionId: reversalTransactionId, lineNumber: e.lineNumber, accountId: e.accountId,
        debit: Number(e.credit), credit: Number(e.debit),
        currencyCode: e.currencyCode, exchangeRate: e.exchangeRate,
        description: `REVERSAL: ${e.description}`, entityType: e.entityType, entityId: e.entityId,
        lotId: e.lotId, cityId: e.cityId, entryDate: reversalDate, createdBy,
      })),
    });
  };

  if (typeof (db as PrismaClient).$transaction === "function") {
    await (db as PrismaClient).$transaction(async (tx) => reverseWithinTransaction(tx));
    return;
  }
  await reverseWithinTransaction(db);
}
