import prisma from "@/lib/prisma";
import { AccountType } from "@prisma/client";

async function getOrCreateAccount(code: string, name: string, type: AccountType, cityId?: number | null): Promise<number> {
  let acc = await prisma.account.findUnique({ where: { code } });
  if (!acc) {
    acc = await prisma.account.create({
      data: { code, name, accountType: type, cityId: cityId || null, isSystem: true },
    });
  }
  return acc.id;
}

export async function getCashAccountId(cityId: number): Promise<number> {
  const city = await prisma.city.findUnique({ where: { id: cityId }, select: { name: true } });
  return getOrCreateAccount(`1001-CITY${cityId}`, `Cash - ${city?.name || cityId}`, "asset", cityId);
}

export async function getChequesInHandAccountId(cityId: number): Promise<number> {
  const city = await prisma.city.findUnique({ where: { id: cityId }, select: { name: true } });
  return getOrCreateAccount(`1002-CHEQUE${cityId}`, `Cheques in Hand - ${city?.name || cityId}`, "asset", cityId);
}

export async function getBankGLAccountId(bankAccountId: number): Promise<number> {
  const bank = await prisma.bankAccount.findUnique({ where: { id: bankAccountId }, select: { bankName: true, accountNumber: true } });
  const label = bank ? `${bank.bankName} ${bank.accountNumber}` : `Bank #${bankAccountId}`;
  return getOrCreateAccount(`1050-BANK${bankAccountId}`, `Bank - ${label}`, "asset");
}

export async function getCustomerAccountId(customerId: number): Promise<number> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } });
  return getOrCreateAccount(`1200-C${customerId}`, `AR - ${customer?.name || customerId}`, "asset");
}

export async function getSupplierAccountId(supplierId: number): Promise<number> {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { name: true } });
  return getOrCreateAccount(`2100-S${supplierId}`, `Payable - ${supplier?.name || supplierId}`, "liability");
}

export async function getAgentAccountId(agentId: number): Promise<number> {
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { name: true } });
  return getOrCreateAccount(`2200-A${agentId}`, `Payable - ${agent?.name || agentId}`, "liability");
}

export async function getShippingLineAccountId(shippingLineId: number): Promise<number> {
  const sl = await prisma.shippingLine.findUnique({ where: { id: shippingLineId }, select: { name: true } });
  return getOrCreateAccount(`2300-SL${shippingLineId}`, `Payable - ${sl?.name || shippingLineId}`, "liability");
}

export async function getInventoryAccountId(): Promise<number> { return getOrCreateAccount("1100", "Inventory", "asset"); }
export async function getSalesRevenueAccountId(): Promise<number> { return getOrCreateAccount("3001", "Sales Revenue", "revenue"); }
export async function getCOGSAccountId(): Promise<number> { return getOrCreateAccount("4001", "Cost of Goods Sold", "cogs"); }
export async function getOwnerWithdrawalAccountId(): Promise<number> { return getOrCreateAccount("6002", "Owner Withdrawals", "equity"); }
export async function getHajiAccountId(): Promise<number> { return getOrCreateAccount("6003", "Haji Account", "equity"); }
export async function getBankAccountId(): Promise<number> { return getOrCreateAccount("1050", "Bank Account (USD)", "asset"); }

export async function getExpenseAccountId(costType: string): Promise<number> {
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
  return getOrCreateAccount(entry.code, entry.name, "expense");
}

interface JournalLine { accountId: number; debit: number; credit: number; description: string; }

export async function createJournalEntries(
  transactionId: string, lines: JournalLine[],
  meta: { currencyCode: string; exchangeRate?: number; entityType: string; entityId: number; lotId?: number | null; cityId?: number | null; entryDate: Date; createdBy: number; }
): Promise<void> {
  const data = lines
    .filter((line) => line.debit !== 0 || line.credit !== 0)
    .map((line) => ({
      transactionId, accountId: line.accountId, debit: line.debit, credit: line.credit,
      currencyCode: meta.currencyCode, exchangeRate: meta.exchangeRate || null, description: line.description,
      entityType: meta.entityType, entityId: meta.entityId, lotId: meta.lotId || null,
      cityId: meta.cityId || null, entryDate: meta.entryDate, createdBy: meta.createdBy,
    }));
  if (data.length > 0) {
    await prisma.journalEntry.createMany({ data });
  }
}

// SALE CREATED
export async function journalSaleCreated(sale: { id: number; customerId: number; cityId: number; lotId: number; totalAmount: number; currencyCode: string; saleDate: Date; createdBy: number; }) {
  const lines: JournalLine[] = [
    { accountId: await getCustomerAccountId(sale.customerId), debit: sale.totalAmount, credit: 0, description: `Sale #${sale.id}` },
    { accountId: await getSalesRevenueAccountId(), debit: 0, credit: sale.totalAmount, description: `Sale #${sale.id}` },
  ];
  await createJournalEntries(`SALE-${sale.id}`, lines, { currencyCode: sale.currencyCode, entityType: "sale", entityId: sale.id, lotId: sale.lotId, cityId: sale.cityId, entryDate: sale.saleDate, createdBy: sale.createdBy });
}

// PAYMENT RECEIVED (cash / bank transfer / online)
export async function journalPaymentReceived(p: { id: number; customerId: number; cityId: number; lotId: number; amount: number; currencyCode: string; paymentDate: Date; createdBy: number; }) {
  await createJournalEntries(`PAY-${p.id}`, [
    { accountId: await getCashAccountId(p.cityId), debit: p.amount, credit: 0, description: `Payment #${p.id}` },
    { accountId: await getCustomerAccountId(p.customerId), debit: 0, credit: p.amount, description: `Payment #${p.id}` },
  ], { currencyCode: p.currencyCode, entityType: "payment", entityId: p.id, lotId: p.lotId, cityId: p.cityId, entryDate: p.paymentDate, createdBy: p.createdBy });
}

// CHEQUE RECEIVED — stages into Cheques in Hand first, not Cash
// DR Cheques in Hand | CR AR - Customer
export async function journalChequeReceived(p: { id: number; customerId: number; cityId: number; lotId: number; amount: number; currencyCode: string; paymentDate: Date; createdBy: number; }) {
  await createJournalEntries(`PAY-${p.id}`, [
    { accountId: await getChequesInHandAccountId(p.cityId), debit: p.amount, credit: 0, description: `Cheque received #${p.id}` },
    { accountId: await getCustomerAccountId(p.customerId), debit: 0, credit: p.amount, description: `Cheque received #${p.id}` },
  ], { currencyCode: p.currencyCode, entityType: "payment", entityId: p.id, lotId: p.lotId, cityId: p.cityId, entryDate: p.paymentDate, createdBy: p.createdBy });
}

// BANK DEPOSIT CREATED
// Cash portion:   DR Bank | CR Cash in Hand
// Each cheque:    DR Bank | CR Cheques in Hand
// Cheques use separate transaction IDs so individual bounces can be reversed without affecting others.
export async function journalBankDeposit(d: {
  id: number; bankAccountId: number; cityId: number; cashAmount: number;
  currencyCode: string; depositDate: Date; createdBy: number;
  cheques: Array<{ paymentId: number; amount: number; }>;
}) {
  const bankAccId = await getBankGLAccountId(d.bankAccountId);
  if (d.cashAmount > 0) {
    await createJournalEntries(`DEP-${d.id}-CASH`, [
      { accountId: bankAccId, debit: d.cashAmount, credit: 0, description: `Deposit #${d.id} — cash` },
      { accountId: await getCashAccountId(d.cityId), debit: 0, credit: d.cashAmount, description: `Deposit #${d.id} — cash` },
    ], { currencyCode: d.currencyCode, entityType: "bank_deposit", entityId: d.id, cityId: d.cityId, entryDate: d.depositDate, createdBy: d.createdBy });
  }
  for (const cheque of d.cheques) {
    await createJournalEntries(`DEP-${d.id}-PAY-${cheque.paymentId}`, [
      { accountId: bankAccId, debit: cheque.amount, credit: 0, description: `Deposit #${d.id} — cheque PAY-${cheque.paymentId}` },
      { accountId: await getChequesInHandAccountId(d.cityId), debit: 0, credit: cheque.amount, description: `Deposit #${d.id} — cheque PAY-${cheque.paymentId}` },
    ], { currencyCode: d.currencyCode, entityType: "bank_deposit", entityId: d.id, cityId: d.cityId, entryDate: d.depositDate, createdBy: d.createdBy });
  }
}

// LOT PURCHASE (buy from company)
export async function journalLotPurchase(p: { id: number; supplierId: number; lotId: number; totalUsd: number; createdBy: number; }) {
  await createJournalEntries(`PURCH-${p.lotId}-${p.id}`, [
    { accountId: await getInventoryAccountId(), debit: p.totalUsd, credit: 0, description: `Purchase Lot` },
    { accountId: await getSupplierAccountId(p.supplierId), debit: 0, credit: p.totalUsd, description: `Supplier payable` },
  ], { currencyCode: "USD", entityType: "lot_purchase", entityId: p.id, lotId: p.lotId, entryDate: new Date(), createdBy: p.createdBy });
}

// SUPPLIER PAID
export async function journalSupplierPaid(p: { id: number; supplierId: number; amountUsd: number; paymentDate: Date; createdBy: number; }) {
  await createJournalEntries(`SUPPPAY-${p.id}`, [
    { accountId: await getSupplierAccountId(p.supplierId), debit: p.amountUsd, credit: 0, description: `Payment to supplier` },
    { accountId: await getBankAccountId(), debit: 0, credit: p.amountUsd, description: `Bank to supplier` },
  ], { currencyCode: "USD", entityType: "supplier_payment", entityId: p.id, entryDate: p.paymentDate, createdBy: p.createdBy });
}

// LOT COST (customs, freight, transport - on agent credit or cash)
export async function journalLotCost(c: { id: number; lotId: number; costType: string; amount: number; currencyCode: string; createdBy: number; agentId?: number; cityId?: number; shippingLineId?: number; }) {
  const expAccId = await getExpenseAccountId(c.costType);
  let creditAccId: number;
  if (c.shippingLineId) { creditAccId = await getShippingLineAccountId(c.shippingLineId); }
  else if (c.agentId) { creditAccId = await getAgentAccountId(c.agentId); }
  else if (c.cityId) { creditAccId = await getCashAccountId(c.cityId); }
  else { creditAccId = await getOrCreateAccount("2999", "General Payable", "liability"); }
  await createJournalEntries(`COST-${c.id}`, [
    { accountId: expAccId, debit: c.amount, credit: 0, description: `${c.costType} Lot #${c.lotId}` },
    { accountId: creditAccId, debit: 0, credit: c.amount, description: `${c.costType}` },
  ], { currencyCode: c.currencyCode, entityType: "lot_cost", entityId: c.id, lotId: c.lotId, cityId: c.cityId, entryDate: new Date(), createdBy: c.createdBy });
}

// AGENT PAID
export async function journalAgentPaid(p: { id: number; agentId: number; cityId: number; amount: number; currencyCode: string; paymentDate: Date; createdBy: number; }) {
  await createJournalEntries(`AGENTPAY-${p.id}`, [
    { accountId: await getAgentAccountId(p.agentId), debit: p.amount, credit: 0, description: `Payment to agent` },
    { accountId: await getCashAccountId(p.cityId), debit: 0, credit: p.amount, description: `Cash to agent` },
  ], { currencyCode: p.currencyCode, entityType: "agent_payment", entityId: p.id, cityId: p.cityId, entryDate: p.paymentDate, createdBy: p.createdBy });
}

// EXPENSE
export async function journalExpenseCreated(e: { id: number; cityId: number; lotId: number; amount: number; currencyCode: string; detail: string; expenseDate: Date; createdBy: number; }) {
  await createJournalEntries(`EXP-${e.id}`, [
    { accountId: await getExpenseAccountId("general"), debit: e.amount, credit: 0, description: e.detail },
    { accountId: await getCashAccountId(e.cityId), debit: 0, credit: e.amount, description: `Expense: ${e.detail}` },
  ], { currencyCode: e.currencyCode, entityType: "expense", entityId: e.id, lotId: e.lotId, cityId: e.cityId, entryDate: e.expenseDate, createdBy: e.createdBy });
}

// WITHDRAWAL
export async function journalWithdrawal(w: { id: number; cityId: number; amount: number; currencyCode: string; date: Date; createdBy: number; }) {
  await createJournalEntries(`WDRAW-${w.id}`, [
    { accountId: await getOwnerWithdrawalAccountId(), debit: w.amount, credit: 0, description: `Owner withdrawal` },
    { accountId: await getCashAccountId(w.cityId), debit: 0, credit: w.amount, description: `Owner withdrawal` },
  ], { currencyCode: w.currencyCode, entityType: "withdrawal", entityId: w.id, cityId: w.cityId, entryDate: w.date, createdBy: w.createdBy });
}

// HAJI TRANSFER
// sourceType "cheque" → CR Cheques in Hand; "bank_transfer" → CR Bank GL; default → CR Cash in Hand
export async function journalHajiTransfer(h: { id: number; cityId: number; amount: number; currencyCode: string; date: Date; createdBy: number; sourceType?: string | null; bankAccountId?: number | null; }) {
  let creditAccId: number;
  if (h.sourceType === "cheque") {
    creditAccId = await getChequesInHandAccountId(h.cityId);
  } else if (h.sourceType === "bank_transfer" && h.bankAccountId) {
    creditAccId = await getBankGLAccountId(h.bankAccountId);
  } else {
    creditAccId = await getCashAccountId(h.cityId);
  }
  await createJournalEntries(`HAJI-${h.id}`, [
    { accountId: await getHajiAccountId(), debit: h.amount, credit: 0, description: `Haji transfer` },
    { accountId: creditAccId, debit: 0, credit: h.amount, description: `Haji transfer` },
  ], { currencyCode: h.currencyCode, entityType: "haji_transfer", entityId: h.id, cityId: h.cityId, entryDate: h.date, createdBy: h.createdBy });
}

// SHIPPING LINE PAID
export async function journalShippingLinePayment(p: { id: number; shippingLineId: number; amountUsd: number; paymentDate: Date; createdBy: number; }) {
  await createJournalEntries(`SLPAY-${p.id}`, [
    { accountId: await getShippingLineAccountId(p.shippingLineId), debit: p.amountUsd, credit: 0, description: `Payment to shipping line` },
    { accountId: await getBankAccountId(), debit: 0, credit: p.amountUsd, description: `Bank to shipping line` },
  ], { currencyCode: "USD", entityType: "shipping_line_payment", entityId: p.id, entryDate: p.paymentDate, createdBy: p.createdBy });
}

// REVERSE (for cancellations)
export async function reverseJournalEntries(transactionId: string, createdBy: number) {
  const entries = await prisma.journalEntry.findMany({ where: { transactionId } });
  if (entries.length === 0) return;
  const now = new Date();
  await prisma.journalEntry.createMany({
    data: entries.map((e) => ({
      transactionId: `REV-${transactionId}`, accountId: e.accountId,
      debit: Number(e.credit), credit: Number(e.debit),
      currencyCode: e.currencyCode, exchangeRate: e.exchangeRate,
      description: `REVERSAL: ${e.description}`, entityType: e.entityType, entityId: e.entityId,
      lotId: e.lotId, cityId: e.cityId, entryDate: now, createdBy,
    })),
  });
}
