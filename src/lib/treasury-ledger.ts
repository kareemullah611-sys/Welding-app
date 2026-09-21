import type { PrismaClient } from "@prisma/client";

type Pot = Record<string, number>;

type CombinedItem = {
  type: string;
  amount: number;
  currencyCode?: string;
  status?: string | null;
  raw?: {
    createdAt?: string | Date | null;
    destination?: string;
    paymentMethod?: string;
    chequeStatus?: string | null;
    status?: string;
    paidFrom?: string;
    sourceType?: string;
    bankAccountId?: number | null;
    paymentId?: number | null;
  };
};

const round2 = (n: number) => Math.round(n * 100) / 100;

function toBalanceMap(rows: { currencyCode: string; total: number }[]): Pot {
  const map: Pot = {};
  for (const row of rows) {
    map[row.currencyCode] = (map[row.currencyCode] || 0) + row.total;
  }
  return map;
}

function addMap(a: Pot, b: Pot): Pot {
  const result: Pot = { ...a };
  for (const [code, amount] of Object.entries(b)) {
    result[code] = (result[code] || 0) + amount;
  }
  return result;
}

function subtractMap(base: Pot, deductions: Pot): Pot {
  const result: Pot = { ...base };
  for (const [code, amount] of Object.entries(deductions)) {
    result[code] = (result[code] || 0) - amount;
  }
  return result;
}

function createdAtMs(item: CombinedItem): number {
  const value = item.raw?.createdAt;
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : 0;
}

function compareCombinedLedgerOldestFirst(
  a: CombinedItem & { id: number; date: string },
  b: CombinedItem & { id: number; date: string }
): number {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (a.type === "payment" && b.type === "haji_transfer" && b.raw?.paymentId === a.id) return -1;
  if (b.type === "payment" && a.type === "haji_transfer" && a.raw?.paymentId === b.id) return 1;
  const createdAtDiff = createdAtMs(a) - createdAtMs(b);
  if (createdAtDiff !== 0) return createdAtDiff;
  return a.id - b.id;
}

/** Credit amount that hit city treasury when a payment was received. */
export function getPaymentTreasuryCreditAmount(raw: CombinedItem["raw"], amount: number): number {
  const value = Number(amount || 0);
  if (!value || (raw?.destination !== "our_account" && raw?.destination !== "haji")) return 0;

  const method = raw?.paymentMethod;
  if (method === "cheque") {
    const chequeStatus = raw?.chequeStatus;
    if (chequeStatus === "bounced") return 0;
    return value;
  }
  if (method === "cash") return value;
  if (method === "bank_transfer" || method === "online") {
    if (raw?.destination === "haji") return value;
    return raw?.bankAccountId ? value : 0;
  }
  return 0;
}

/** Net-position delta for one finance/combined row (treasury pot rules). */
export function getCombinedItemNetDelta(item: CombinedItem): number {
  const amount = Number(item.amount || 0);
  if (!amount) return 0;

  if (item.type === "payment") {
    return getPaymentTreasuryCreditAmount(item.raw, amount);
  }

  if (item.type === "payment_reversal") {
    return -getPaymentTreasuryCreditAmount(item.raw, amount);
  }

  if (item.type === "expense") {
    const paidFrom = item.raw?.paidFrom || "cash_office";
    if (paidFrom === "cash_office" || paidFrom === "bank_account" || paidFrom === "cheque" || paidFrom === "customer") {
      return -amount;
    }
    return 0;
  }

  if (item.type === "haji_transfer") {
    const source = item.raw?.sourceType || "cash_office";
    if (source === "cash_office" || source === "bank_transfer" || source === "cheque") {
      return -amount;
    }
    return 0;
  }

  if (item.type === "withdrawal") {
    const source = item.raw?.sourceType || "cash_office";
    if (source === "cash_office" || source === "bank_account" || source === "cheque") return -amount;
    return 0;
  }

  return 0;
}

/** Incoming funds to super-admin haji view (payments + city haji transfers). */
export function getSuperAdminHajiIncomingDelta(item: CombinedItem): number {
  const amount = Number(item.amount || 0);
  if (!amount) return 0;

  if (item.type === "payment") {
    if (item.raw?.destination !== "haji" || item.status === "cancelled") return 0;
    return amount;
  }
  if (item.type === "payment_reversal") {
    if (item.raw?.destination !== "haji") return 0;
    return -amount;
  }
  if (item.type === "haji_transfer") {
    return amount;
  }
  return 0;
}

export function computeSuperAdminRunningBalances(
  items: Array<CombinedItem & { id: number; date: string }>,
): { itemsWithBalance: Array<CombinedItem & { id: number; date: string; runningBalance: number }>; balanceByCurrency: Pot } {
  const asc = [...items].sort(compareCombinedLedgerOldestFirst);

  const runningByCurrency: Pot = {};
  const itemsWithBalance = asc.map((item) => {
    const currencyCode = item.currencyCode || "";
    const delta = getSuperAdminHajiIncomingDelta(item);
    runningByCurrency[currencyCode] = round2((runningByCurrency[currencyCode] || 0) + delta);
    return {
      ...item,
      runningBalance: runningByCurrency[currencyCode] || 0,
    };
  });

  return { itemsWithBalance, balanceByCurrency: runningByCurrency };
}

export function computeRunningBalances(
  items: Array<CombinedItem & { id: number; date: string }>,
  openingCashByCurrency: Pot
): { itemsWithBalance: Array<CombinedItem & { id: number; date: string; runningBalance: number }>; balanceByCurrency: Pot } {
  const asc = [...items].sort(compareCombinedLedgerOldestFirst);

  const runningByCurrency: Pot = { ...openingCashByCurrency };
  const itemsWithBalance = asc.map((item) => {
    const currencyCode = item.currencyCode || "";
    const delta = getCombinedItemNetDelta(item);
    runningByCurrency[currencyCode] = round2((runningByCurrency[currencyCode] || 0) + delta);
    return {
      ...item,
      runningBalance: runningByCurrency[currencyCode] || 0,
    };
  });

  return { itemsWithBalance, balanceByCurrency: runningByCurrency };
}

/** Authoritative net balance (cash + cheques + bank) — same pots as /api/v1/treasury. */
export async function computeCityTreasuryNet(
  prisma: PrismaClient,
  cityId: number
): Promise<Pot> {
  const codeById: Record<number, string> = {};
  const resolveCodes = async (ids: number[]) => {
    const missing = ids.filter((id) => !codeById[id]);
    if (!missing.length) return;
    const rows = await prisma.currency.findMany({
      where: { id: { in: Array.from(new Set(missing)) } },
      select: { id: true, code: true },
    });
    for (const c of rows) codeById[c.id] = c.code;
  };

  const mapRows = async (rows: { currencyId: number; _sum?: { amount?: unknown; cashAmount?: unknown } | null }[], field: "amount" | "cashAmount" = "amount") => {
    await resolveCodes(rows.map((r) => r.currencyId));
    return toBalanceMap(
      rows.map((r) => ({
        currencyCode: codeById[r.currencyId] ?? String(r.currencyId),
        total: Number(field === "cashAmount" ? r._sum?.cashAmount ?? 0 : r._sum?.amount ?? 0),
      }))
    );
  };

  const [
    cashPaymentsRaw,
    openingCashRaw,
    openingBankRaw,
    hajiFromCashRaw,
    expensesFromCashRaw,
    depositsRaw,
    withdrawalsRaw,
    chequesInHandRaw,
    bankPaymentsRaw,
    depositedChequesRaw,
    hajiFromBankRaw,
    expensesFromBankRaw,
    withdrawalsFromBankRaw,
    cityBankAccounts,
  ] = await Promise.all([
    prisma.payment.groupBy({
      by: ["currencyId"],
      where: { cityId, paymentMethod: "cash", destination: "our_account", status: "active" },
      _sum: { amount: true },
    }),
    prisma.openingCash.groupBy({ by: ["currencyId"], where: { cityId }, _sum: { amount: true } }),
    prisma.openingBankBalance.groupBy({
      by: ["currencyId"],
      where: { bankAccount: { cityId } },
      _sum: { amount: true },
    }),
    prisma.hajiTransfer.groupBy({
      by: ["currencyId"],
      where: { cityId, sourceType: "cash_office", withdrawalSource: null },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["currencyId"],
      where: { cityId, paidFrom: { in: ["cash_office", "customer"] }, deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.bankDeposit.groupBy({ by: ["currencyId"], where: { cityId }, _sum: { cashAmount: true } }),
    prisma.personalWithdrawal.groupBy({
      by: ["currencyId"],
      where: { cityId, sourceType: "cash_office" } as any,
      _sum: { amount: true },
    }),
    prisma.payment.groupBy({
      by: ["currencyId"],
      where: {
        cityId,
        paymentMethod: "cheque",
        destination: "our_account",
        status: "active",
        chequeStatus: "in_hand",
      },
      _sum: { amount: true },
    }),
    prisma.payment.groupBy({
      by: ["currencyId"],
      where: {
        cityId,
        paymentMethod: { in: ["bank_transfer", "online"] },
        destination: "our_account",
        status: "active",
        bankAccountId: { not: null },
      },
      _sum: { amount: true },
    } as any),
    prisma.payment.groupBy({
      by: ["currencyId"],
      where: {
        cityId,
        paymentMethod: "cheque",
        destination: "our_account",
        status: "active",
        chequeStatus: "deposited_to_bank",
        bankDepositId: { not: null },
      },
      _sum: { amount: true },
    }),
    prisma.hajiTransfer.groupBy({
      by: ["currencyId"],
      where: { cityId, sourceType: "bank_transfer", bankAccountId: { not: null }, withdrawalSource: null },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["currencyId"],
      where: { cityId, paidFrom: "bank_account", bankAccountId: { not: null }, deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.personalWithdrawal.groupBy({
      by: ["currencyId"],
      where: { cityId, sourceType: "bank_account", bankAccountId: { not: null } } as any,
      _sum: { amount: true },
    }),
    prisma.bankAccount.findMany({ where: { cityId }, select: { id: true } }),
  ]);

  const liabilityEntries = await prisma.superAdminLiabilityEntry.findMany({
    where: { cityId, sourceType: { in: ["city_cash", "city_bank"] } },
    select: { sourceType: true, currencyId: true, liabilityEffect: true },
  });
  await resolveCodes(liabilityEntries.map((entry) => entry.currencyId));
  const liabilityCashEffect: Pot = {};
  const liabilityBankEffect: Pot = {};
  for (const entry of liabilityEntries) {
    const code = codeById[entry.currencyId] ?? String(entry.currencyId);
    const target = entry.sourceType === "city_cash" ? liabilityCashEffect : liabilityBankEffect;
    target[code] = (target[code] || 0) + Number(entry.liabilityEffect || 0);
  }

  const cashInOffice = addMap(subtractMap(
    subtractMap(
      subtractMap(
        subtractMap(addMap(await mapRows(openingCashRaw), await mapRows(cashPaymentsRaw)), await mapRows(hajiFromCashRaw)),
        await mapRows(expensesFromCashRaw)
      ),
      await mapRows(depositsRaw, "cashAmount")
    ),
    await mapRows(withdrawalsRaw)
  ), liabilityCashEffect);

  const chequesInHand = await mapRows(chequesInHandRaw);

  const cityBankAccountIds = cityBankAccounts.map((a) => a.id);
  const supplierPaymentsFromBank = await prisma.supplierPayment.findMany({
    where: {
      bankAccountId: cityBankAccountIds.length > 0 ? { in: cityBankAccountIds } : { in: [-1] },
      deletedAt: null,
    },
    select: { amountLocal: true, amountUsd: true, exchangeRate: true },
  });

  const supplierBankOut: Pot = {};
  for (const payment of supplierPaymentsFromBank) {
    const amountLocal = Number(payment.amountLocal || 0);
    const amountUsd = Number(payment.amountUsd || 0);
    const exchangeRate = Number(payment.exchangeRate || 0);
    const amountPkr = amountLocal > 0 ? amountLocal : exchangeRate > 0 ? amountUsd * exchangeRate : 0;
    const currencyCode = amountPkr > 0 ? "PKR" : "USD";
    const amountOut = amountPkr > 0 ? amountPkr : amountUsd;
    if (!amountOut) continue;
    supplierBankOut[currencyCode] = (supplierBankOut[currencyCode] || 0) + amountOut;
  }

  let bankBalance = addMap(
    addMap(addMap(await mapRows(openingBankRaw), await mapRows(bankPaymentsRaw)), await mapRows(depositsRaw, "cashAmount")),
    await mapRows(depositedChequesRaw)
  );
  bankBalance = subtractMap(
    subtractMap(
      subtractMap(subtractMap(bankBalance, await mapRows(hajiFromBankRaw)), await mapRows(expensesFromBankRaw)),
      await mapRows(withdrawalsFromBankRaw)
    ),
    supplierBankOut
  );
  bankBalance = addMap(bankBalance, liabilityBankEffect);

  return addMap(addMap(cashInOffice, chequesInHand), bankBalance);
}

export function buildPaymentCancellationReversalRow(p: any) {
  if (p.status !== "cancelled" || !p.cancelledAt) return null;
  const cancelDate = p.cancelledAt instanceof Date
    ? p.cancelledAt.toISOString().split("T")[0]
    : String(p.cancelledAt).split("T")[0];
  return {
    id: -Math.abs(Number(p.id)),
    type: "payment_reversal",
    date: cancelDate,
    detail: p.cancellationReason ? `Cancellation — ${p.cancellationReason}` : `Cancellation — ${p.detail}`,
    amount: Number(p.amount),
    currencySymbol: p.currency.symbol,
    currencyCode: p.currency.code,
    person: p.customer?.name ?? null,
    cityName: p.city?.name ?? null,
    status: "cancelled",
    raw: {
      ...p,
      amount: Number(p.amount),
      exchangeRate: p.exchangeRate ? Number(p.exchangeRate) : null,
      usdEquivalent: p.usdEquivalent ? Number(p.usdEquivalent) : null,
      bankAccount: p.bankAccount ?? null,
      bankAccountId: p.bankAccountId ?? null,
      superAdminBankAccount: p.superAdminBankAccount ?? null,
      superAdminBankAccountId: p.superAdminBankAccountId ?? null,
      reversalOfPaymentId: p.id,
      paymentDate: p.paymentDate,
      attachments: [],
    },
  };
}
