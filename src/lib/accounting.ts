import prisma from "@/lib/prisma";
import { AccountType, Prisma, PrismaClient } from "@prisma/client";
import { computeLotLandedCostPkr, groupExpensesByCurrency } from "@/lib/landed-cost-pkr";

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
export async function getOpeningBalanceAccountId(db: DbClient = prisma): Promise<number> { return getOrCreateAccount("3900", "Opening Balances", "equity", undefined, db); }
export async function getBankAccountId(db: DbClient = prisma): Promise<number> { return getOrCreateAccount("1050", "Bank Account (USD)", "asset", undefined, db); }

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

interface JournalLine { accountId: number; debit: number; credit: number; description: string; currencyCode?: string; }

export async function createJournalEntries(
  transactionId: string, lines: JournalLine[],
  meta: { currencyCode: string; exchangeRate?: number; entityType: string; entityId: number; lotId?: number | null; cityId?: number | null; entryDate: Date; createdBy: number; }
  , db: DbClient = prisma
): Promise<void> {
  const data = lines
    .filter((line) => line.debit !== 0 || line.credit !== 0)
    .map((line) => ({
      transactionId, accountId: line.accountId, debit: line.debit, credit: line.credit,
      currencyCode: line.currencyCode || meta.currencyCode, exchangeRate: meta.exchangeRate || null, description: line.description,
      entityType: meta.entityType, entityId: meta.entityId, lotId: meta.lotId || null,
      cityId: meta.cityId || null, entryDate: meta.entryDate, createdBy: meta.createdBy,
    }));
  if (data.length > 0) {
    await db.journalEntry.createMany({ data });
  }
}

// SALE CREATED
export async function journalSaleCreated(sale: { id: number; customerId: number; cityId: number; lotId: number; totalAmount: number; currencyCode: string; saleDate: Date; createdBy: number; }, db: DbClient = prisma) {
  const lines: JournalLine[] = [
    { accountId: await getCustomerAccountId(sale.customerId, db), debit: sale.totalAmount, credit: 0, description: `Sale #${sale.id}` },
    { accountId: await getSalesRevenueAccountId(db), debit: 0, credit: sale.totalAmount, description: `Sale #${sale.id}` },
  ];
  await createJournalEntries(`SALE-${sale.id}`, lines, { currencyCode: sale.currencyCode, entityType: "sale", entityId: sale.id, lotId: sale.lotId, cityId: sale.cityId, entryDate: sale.saleDate, createdBy: sale.createdBy }, db);
}

// PAYMENT RECEIVED (cash / bank transfer / online / direct-to-haji)
export async function journalPaymentReceived(
  p: {
    id: number; customerId: number; cityId: number; lotId: number;
    amount: number; currencyCode: string; paymentDate: Date; createdBy: number;
    destination?: string | null; superAdminBankAccountId?: number | null;
    bankAccountId?: number | null; paymentMethod?: string | null;
  },
  db: DbClient = prisma
) {
  let debitAccId: number;
  if (p.destination === "haji" && p.superAdminBankAccountId) {
    debitAccId = await getSuperAdminBankGLAccountId(p.superAdminBankAccountId, db);
  } else if (p.destination === "haji") {
    debitAccId = await getHajiAccountId(db);
  } else if (p.bankAccountId && p.paymentMethod === "bank_transfer") {
    debitAccId = await getBankGLAccountId(p.bankAccountId, db);
  } else {
    debitAccId = await getCashAccountId(p.cityId, db);
  }

  await createJournalEntries(`PAY-${p.id}`, [
    { accountId: debitAccId, debit: p.amount, credit: 0, description: `Payment #${p.id}` },
    { accountId: await getCustomerAccountId(p.customerId, db), debit: 0, credit: p.amount, description: `Payment #${p.id}` },
  ], { currencyCode: p.currencyCode, entityType: "payment", entityId: p.id, lotId: p.lotId, cityId: p.cityId, entryDate: p.paymentDate, createdBy: p.createdBy }, db);
}

// CHEQUE RECEIVED — stages into Cheques in Hand first, not Cash
// DR Cheques in Hand | CR AR - Customer
export async function journalChequeReceived(p: { id: number; customerId: number; cityId: number; lotId: number; amount: number; currencyCode: string; paymentDate: Date; createdBy: number; }, db: DbClient = prisma) {
  await createJournalEntries(`PAY-${p.id}`, [
    { accountId: await getChequesInHandAccountId(p.cityId, db), debit: p.amount, credit: 0, description: `Cheque received #${p.id}` },
    { accountId: await getCustomerAccountId(p.customerId, db), debit: 0, credit: p.amount, description: `Cheque received #${p.id}` },
  ], { currencyCode: p.currencyCode, entityType: "payment", entityId: p.id, lotId: p.lotId, cityId: p.cityId, entryDate: p.paymentDate, createdBy: p.createdBy }, db);
}

// BANK DEPOSIT CREATED
// Cash portion:   DR Bank | CR Cash in Hand
// Each cheque:    DR Bank | CR Cheques in Hand
// Cheques use separate transaction IDs so individual bounces can be reversed without affecting others.
export async function journalBankDeposit(d: {
  id: number; bankAccountId: number; cityId: number; cashAmount: number;
  currencyCode: string; depositDate: Date; createdBy: number;
  cheques: Array<{ paymentId: number; amount: number; }>;
  transactionKeySuffix?: string;
}, db: DbClient = prisma) {
  const bankAccId = await getBankGLAccountId(d.bankAccountId, db);
  const txKey = d.transactionKeySuffix ? `DEP-${d.id}-${d.transactionKeySuffix}` : `DEP-${d.id}`;
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
export async function journalLotPurchase(p: { id: number; supplierId: number; lotId: number; totalUsd: number; createdBy: number; }, db: DbClient = prisma) {
  await createJournalEntries(`PURCH-${p.lotId}-${p.id}`, [
    { accountId: await getInventoryAccountId(db), debit: p.totalUsd, credit: 0, description: `Purchase Lot` },
    { accountId: await getSupplierAccountId(p.supplierId, db), debit: 0, credit: p.totalUsd, description: `Supplier payable` },
  ], { currencyCode: "USD", entityType: "lot_purchase", entityId: p.id, lotId: p.lotId, entryDate: new Date(), createdBy: p.createdBy }, db);
}

// SUPPLIER PAID — supplier debit in USD; bank credit in settlement currency (PKR when paid from PKR bank)
export async function journalSupplierPaid(
  p: {
    id: number; supplierId: number; amountUsd: number; amountLocal?: number | null;
    paymentDate: Date; createdBy: number;
    bankAccountId?: number | null;
    superAdminBankAccountId?: number | null;
    superAdminCashAccountId?: number | null;
    intermediaryId?: number | null;
    settlementCurrencyCode?: string | null;
  },
  db: DbClient = prisma
) {
  let creditAccId: number;
  let creditAmount = p.amountUsd;
  let creditCurrency = "USD";

  if (p.intermediaryId) {
    creditAccId = await getIntermediaryAccountId(p.intermediaryId, db);
  } else if (p.superAdminCashAccountId) {
    creditAccId = await getSuperAdminCashGLAccountId(p.superAdminCashAccountId, db);
    if (p.amountLocal && Number(p.amountLocal) > 0) {
      creditAmount = Number(p.amountLocal);
      creditCurrency = p.settlementCurrencyCode || creditCurrency;
    }
  } else if (p.superAdminBankAccountId) {
    creditAccId = await getSuperAdminBankGLAccountId(p.superAdminBankAccountId, db);
    if (p.amountLocal && Number(p.amountLocal) > 0) {
      creditAmount = Number(p.amountLocal);
      creditCurrency = p.settlementCurrencyCode || "PKR";
    }
  } else if (p.bankAccountId) {
    creditAccId = await getBankGLAccountId(p.bankAccountId, db);
    if (p.amountLocal && Number(p.amountLocal) > 0) {
      creditAmount = Number(p.amountLocal);
      creditCurrency = p.settlementCurrencyCode || "PKR";
    }
  } else {
    creditAccId = await getBankAccountId(db);
  }

  await createJournalEntries(`SUPPPAY-${p.id}`, [
    { accountId: await getSupplierAccountId(p.supplierId, db), debit: p.amountUsd, credit: 0, description: `Payment to supplier`, currencyCode: "USD" },
    { accountId: creditAccId, debit: 0, credit: creditAmount, description: p.intermediaryId ? `Through intermediary` : `Bank to supplier`, currencyCode: creditCurrency },
  ], { currencyCode: "USD", entityType: "supplier_payment", entityId: p.id, entryDate: p.paymentDate, createdBy: p.createdBy }, db);
}

// LOT COST (customs, freight, transport - on agent credit or cash)
export async function journalLotCost(c: {
  id: number;
  lotId: number;
  costType: string;
  amount: number;
  currencyCode: string;
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
  const expAccId = await getExpenseAccountId(c.costType, db);
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
  await createJournalEntries(`COST-${c.id}`, [
    { accountId: expAccId, debit: c.amount, credit: 0, description: `${c.costType} Lot #${c.lotId}` },
    { accountId: creditAccId, debit: 0, credit: c.amount, description: `${c.costType}` },
  ], { currencyCode: c.currencyCode, entityType: "lot_cost", entityId: c.id, lotId: c.lotId, cityId: c.cityId, entryDate: new Date(), createdBy: c.createdBy }, db);
}

// AGENT PAID
// Source priority: intermediary → specific bank → city cash
export async function journalAgentPaid(p: { id: number; agentId: number; cityId: number; amount: number; currencyCode: string; paymentDate: Date; createdBy: number; bankAccountId?: number | null; intermediaryId?: number | null; superAdminCashAccountId?: number | null; }) {
  let creditAccId: number;
  if (p.intermediaryId) {
    creditAccId = await getIntermediaryAccountId(p.intermediaryId);
  } else if (p.superAdminCashAccountId) {
    creditAccId = await getSuperAdminCashGLAccountId(p.superAdminCashAccountId);
  } else if (p.bankAccountId) {
    creditAccId = await getBankGLAccountId(p.bankAccountId);
  } else {
    creditAccId = await getCashAccountId(p.cityId);
  }
  await createJournalEntries(`AGENTPAY-${p.id}`, [
    { accountId: await getAgentAccountId(p.agentId), debit: p.amount, credit: 0, description: `Payment to agent` },
    { accountId: creditAccId, debit: 0, credit: p.amount, description: p.intermediaryId ? `Via intermediary` : p.bankAccountId ? `Bank to agent` : `Cash to agent` },
  ], { currencyCode: p.currencyCode, entityType: "agent_payment", entityId: p.id, cityId: p.cityId, entryDate: p.paymentDate, createdBy: p.createdBy });
}

// EXPENSE
// CR account depends on paidFrom: bank_account → specific bank GL, else city cash
export async function journalExpenseCreated(e: { id: number; cityId: number; lotId: number; amount: number; currencyCode: string; detail: string; expenseDate: Date; createdBy: number; paidFrom?: string | null; bankAccountId?: number | null; }, db: DbClient = prisma) {
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
export async function journalWithdrawal(w: { id: number; cityId: number; amount: number; currencyCode: string; date: Date; createdBy: number; sourceType?: string | null; }, db: DbClient = prisma) {
  const creditAccId = w.sourceType === "cheque"
    ? await getChequesInHandAccountId(w.cityId, db)
    : await getCashAccountId(w.cityId, db);
  await createJournalEntries(`WDRAW-${w.id}`, [
    { accountId: await getOwnerWithdrawalAccountId(db), debit: w.amount, credit: 0, description: `Owner withdrawal` },
    { accountId: creditAccId, debit: 0, credit: w.amount, description: `Owner withdrawal` },
  ], { currencyCode: w.currencyCode, entityType: "withdrawal", entityId: w.id, cityId: w.cityId, entryDate: w.date, createdBy: w.createdBy }, db);
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

  await createJournalEntries(`HAJI-${h.id}`, [
    { accountId: debitAccId, debit: h.amount, credit: 0, description: `Haji transfer` },
    { accountId: creditAccId, debit: 0, credit: h.amount, description: `Haji transfer` },
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
}) {
  let creditAccId: number;
  if (d.sourceType === "super_admin_cash" && d.superAdminCashAccountId) {
    creditAccId = await getSuperAdminCashGLAccountId(d.superAdminCashAccountId);
  } else if (d.sourceType === "super_admin_bank_account" && d.superAdminBankAccountId) {
    creditAccId = await getSuperAdminBankGLAccountId(d.superAdminBankAccountId);
  } else if (d.sourceType === "bank_account" && d.bankAccountId) {
    creditAccId = await getBankGLAccountId(d.bankAccountId);
  } else if (d.cityId) {
    creditAccId = await getCashAccountId(d.cityId);
  } else {
    creditAccId = await getOrCreateAccount("1050", "Bank Account (USD)", "asset");
  }
  await createJournalEntries(`INTDEP-${d.id}`, [
    { accountId: await getIntermediaryAccountId(d.intermediaryId), debit: d.amount, credit: 0, description: `Deposit to intermediary #${d.intermediaryId}` },
    { accountId: creditAccId, debit: 0, credit: d.amount, description: `Deposit to intermediary #${d.intermediaryId}` },
  ], { currencyCode: d.currencyCode, entityType: "intermediary_deposit", entityId: d.id, cityId: d.cityId, entryDate: d.depositDate, createdBy: d.createdBy });
}

export async function journalHajiCashReceipt(r: {
  id: number;
  superAdminCashAccountId: number;
  intermediaryId: number;
  amount: number;
  currencyCode: string;
  receiptDate: Date;
  createdBy: number;
}, db: DbClient = prisma) {
  await createJournalEntries(`HAJIREC-${r.id}`, [
    { accountId: await getSuperAdminCashGLAccountId(r.superAdminCashAccountId, db), debit: r.amount, credit: 0, description: `Receipt from intermediary #${r.intermediaryId}` },
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
}) {
  const intermediaryAccountId = await getIntermediaryAccountId(e.intermediaryId);
  const fxClearingAccountId = await getIntermediaryFxClearingAccountId(e.intermediaryId);

  await createJournalEntries(`INTFX-OUT-${e.id}`, [
    { accountId: fxClearingAccountId, debit: e.fromAmount, credit: 0, description: `FX OUT #${e.id}` },
    { accountId: intermediaryAccountId, debit: 0, credit: e.fromAmount, description: `FX OUT #${e.id}` },
  ], {
    currencyCode: e.fromCurrencyCode,
    entityType: "intermediary_exchange",
    entityId: e.id,
    entryDate: e.exchangeDate,
    createdBy: e.createdBy,
  });

  await createJournalEntries(`INTFX-IN-${e.id}`, [
    { accountId: intermediaryAccountId, debit: e.toAmount, credit: 0, description: `FX IN #${e.id}` },
    { accountId: fxClearingAccountId, debit: 0, credit: e.toAmount, description: `FX IN #${e.id}` },
  ], {
    currencyCode: e.toCurrencyCode,
    entityType: "intermediary_exchange",
    entityId: e.id,
    entryDate: e.exchangeDate,
    createdBy: e.createdBy,
  });
}

// OPENING LIABILITY — pre-go-live payables flow into party GL accounts
export async function journalOpeningLiability(
  p: {
    id: number;
    liabilityType: string;
    partyId: number;
    amount: number;
    currencyCode: string;
    openingDate: Date;
    createdBy: number;
  },
  db: DbClient = prisma
) {
  let creditAccId: number;
  if (p.liabilityType === "supplier") creditAccId = await getSupplierAccountId(p.partyId, db);
  else if (p.liabilityType === "shipping_line") creditAccId = await getShippingLineAccountId(p.partyId, db);
  else if (p.liabilityType === "agent") creditAccId = await getAgentAccountId(p.partyId, db);
  else creditAccId = await getIntermediaryAccountId(p.partyId, db);

  await createJournalEntries(`OPENLIAB-${p.id}`, [
    { accountId: await getOpeningBalanceAccountId(db), debit: p.amount, credit: 0, description: `Opening liability` },
    { accountId: creditAccId, debit: 0, credit: p.amount, description: `Opening liability` },
  ], {
    currencyCode: p.currencyCode,
    entityType: "opening_liability",
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
  },
  db: DbClient = prisma
) {
  await createJournalEntries(`SAEXP-${e.id}`, [
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

// SHIPPING LINE PAID
// Source priority: intermediary → specific bank → generic bank
export async function journalShippingLinePayment(p: { id: number; shippingLineId: number; amountUsd: number; paymentDate: Date; createdBy: number; bankAccountId?: number | null; intermediaryId?: number | null; superAdminCashAccountId?: number | null; amountLocal?: number | null; settlementCurrencyCode?: string | null; }) {
  let creditAccId: number;
  if (p.intermediaryId) {
    creditAccId = await getIntermediaryAccountId(p.intermediaryId);
  } else if (p.superAdminCashAccountId) {
    creditAccId = await getSuperAdminCashGLAccountId(p.superAdminCashAccountId);
  } else if (p.bankAccountId) {
    creditAccId = await getBankGLAccountId(p.bankAccountId);
  } else {
    creditAccId = await getBankAccountId();
  }
  const creditAmount = p.amountLocal && Number(p.amountLocal) > 0 ? Number(p.amountLocal) : p.amountUsd;
  const creditCurrency = p.amountLocal && Number(p.amountLocal) > 0 ? (p.settlementCurrencyCode || "PKR") : "USD";
  await createJournalEntries(`SLPAY-${p.id}`, [
    { accountId: await getShippingLineAccountId(p.shippingLineId), debit: p.amountUsd, credit: 0, description: `Payment to shipping line` },
    { accountId: creditAccId, debit: 0, credit: creditAmount, description: p.intermediaryId ? `Via intermediary` : `Payment to shipping line`, currencyCode: creditCurrency },
  ], { currencyCode: "USD", entityType: "shipping_line_payment", entityId: p.id, entryDate: p.paymentDate, createdBy: p.createdBy });
}

// COGS AT POINT OF SALE
// Computes landed cost per carton from lot data and journals:
// DR Cost of Goods Sold | CR Inventory
export async function journalSaleCOGS(params: {
  saleId: number; lotId: number; totalQtySold: number;
  saleDate: Date; cityId: number; createdBy: number;
}, db: DbClient = prisma) {
  const { saleId, lotId, totalQtySold, saleDate, cityId, createdBy } = params;

  const [lot, purchases, costs, lotProducts, lotExpenses] = await Promise.all([
    db.lot.findUnique({ where: { id: lotId }, select: { pkrExchangeRate: true } }),
    db.lotPurchase.aggregate({ where: { lotId }, _sum: { totalPriceUsd: true } }),
    db.lotCost.findMany({
      where: { lotId },
      select: { amount: true, currencyCode: true, exchangeRate: true, costType: true },
    }),
    db.lotProduct.aggregate({ where: { lotId }, _sum: { totalQty: true } }),
    db.expense.findMany({
      where: { lotId, deletedAt: null },
      select: { amount: true, currency: { select: { code: true } } },
    }),
  ]);

  const usdPkrRate = Number(lot?.pkrExchangeRate || 0);
  const totalCartons = Number(lotProducts._sum.totalQty || 0);
  if (totalCartons === 0 || totalQtySold === 0 || usdPkrRate <= 0) return;

  const landed = computeLotLandedCostPkr({
    totalPurchaseUsd: Number(purchases._sum.totalPriceUsd || 0),
    totalCartons,
    lotCosts: costs,
    lotExpensesByCurrency: groupExpensesByCurrency(lotExpenses),
    usdPkrRate,
  });

  if (landed.landedCostPerCartonPkr <= 0) return;

  const cogsAmount = Math.round(totalQtySold * landed.landedCostPerCartonPkr * 100) / 100;
  if (cogsAmount <= 0) return;

  await createJournalEntries(`COGS-${saleId}`, [
    { accountId: await getCOGSAccountId(db), debit: cogsAmount, credit: 0, description: `COGS — Sale #${saleId}` },
    { accountId: await getInventoryAccountId(db), debit: 0, credit: cogsAmount, description: `Inventory reduction — Sale #${saleId}` },
  ], { currencyCode: "PKR", entityType: "sale", entityId: saleId, lotId, cityId, entryDate: saleDate, createdBy }, db);
}

// REVERSE (for cancellations)
export async function reverseJournalEntries(transactionId: string, createdBy: number, db: DbClient = prisma) {
  const entries = await db.journalEntry.findMany({ where: { transactionId } });
  if (entries.length === 0) return;
  const now = new Date();
  await db.journalEntry.createMany({
    data: entries.map((e) => ({
      transactionId: `REV-${transactionId}`, accountId: e.accountId,
      debit: Number(e.credit), credit: Number(e.debit),
      currencyCode: e.currencyCode, exchangeRate: e.exchangeRate,
      description: `REVERSAL: ${e.description}`, entityType: e.entityType, entityId: e.entityId,
      lotId: e.lotId, cityId: e.cityId, entryDate: now, createdBy,
    })),
  });
}
