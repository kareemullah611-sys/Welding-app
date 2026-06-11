import type { PrismaClient } from "@prisma/client";

type Pot = Record<string, number>;

type CombinedItem = {
  type: string;
  amount: number;
  currencyCode?: string;
  status?: string | null;
  raw?: {
    destination?: string;
    paymentMethod?: string;
    chequeStatus?: string | null;
    status?: string;
    paidFrom?: string;
    sourceType?: string;
    bankAccountId?: number | null;
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

/** Net-position delta for one finance/combined row (treasury pot rules). */
export function getCombinedItemNetDelta(item: CombinedItem): number {
  const amount = Number(item.amount || 0);
  if (!amount) return 0;

  if (item.type === "payment") {
    if (item.status !== "active" && item.raw?.status !== "active") return 0;
    if (item.raw?.destination !== "our_account") return 0;

    const method = item.raw?.paymentMethod;
    if (method === "cheque") {
      const status = item.raw?.chequeStatus;
      if (status === "bounced") return 0;
      // Count toward net while still in our hands or already in bank via deposit.
      if (status === "in_hand" || status === "deposited_to_bank") return amount;
      return 0;
    }
    if (method === "cash") return amount;
    if (method === "bank_transfer" || method === "online") {
      return item.raw?.bankAccountId ? amount : 0;
    }
    return 0;
  }

  if (item.type === "expense") {
    const paidFrom = item.raw?.paidFrom || "cash_office";
    if (paidFrom === "cash_office" || paidFrom === "bank_account" || paidFrom === "cheque") {
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
    if (source === "cash_office" || source === "cheque") return -amount;
    return 0;
  }

  return 0;
}

export function computeRunningBalances(
  items: Array<CombinedItem & { id: number; date: string }>,
  openingCashByCurrency: Pot
): { itemsWithBalance: Array<CombinedItem & { id: number; date: string; runningBalance: number }>; balanceByCurrency: Pot } {
  const asc = [...items].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return a.id - b.id;
  });

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
    hajiFromCashRaw,
    expensesFromCashRaw,
    depositsRaw,
    withdrawalsRaw,
    chequesInHandRaw,
    bankPaymentsRaw,
    depositedChequesRaw,
    hajiFromBankRaw,
    expensesFromBankRaw,
    cityBankAccounts,
  ] = await Promise.all([
    prisma.payment.groupBy({
      by: ["currencyId"],
      where: { cityId, paymentMethod: "cash", destination: "our_account", status: "active" },
      _sum: { amount: true },
    }),
    prisma.openingCash.groupBy({ by: ["currencyId"], where: { cityId }, _sum: { amount: true } }),
    prisma.hajiTransfer.groupBy({
      by: ["currencyId"],
      where: { cityId, sourceType: "cash_office" },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["currencyId"],
      where: { cityId, paidFrom: "cash_office", deletedAt: null },
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
      },
      _sum: { amount: true },
    }),
    prisma.hajiTransfer.groupBy({
      by: ["currencyId"],
      where: { cityId, sourceType: "bank_transfer" },
      _sum: { amount: true },
    }),
    prisma.expense.groupBy({
      by: ["currencyId"],
      where: { cityId, paidFrom: "bank_account", deletedAt: null },
      _sum: { amount: true },
    }),
    prisma.bankAccount.findMany({ where: { cityId }, select: { id: true } }),
  ]);

  const cashInOffice = subtractMap(
    subtractMap(
      subtractMap(
        subtractMap(addMap(await mapRows(openingCashRaw), await mapRows(cashPaymentsRaw)), await mapRows(hajiFromCashRaw)),
        await mapRows(expensesFromCashRaw)
      ),
      await mapRows(depositsRaw, "cashAmount")
    ),
    await mapRows(withdrawalsRaw)
  );

  const chequesInHand = await mapRows(chequesInHandRaw);

  const cityBankAccountIds = cityBankAccounts.map((a) => a.id);
  const supplierPaymentsFromBank = await prisma.supplierPayment.findMany({
    where: {
      bankAccountId: cityBankAccountIds.length > 0 ? { in: cityBankAccountIds } : { in: [-1] },
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
    addMap(await mapRows(bankPaymentsRaw), await mapRows(depositsRaw, "cashAmount")),
    await mapRows(depositedChequesRaw)
  );
  bankBalance = subtractMap(
    subtractMap(subtractMap(bankBalance, await mapRows(hajiFromBankRaw)), await mapRows(expensesFromBankRaw)),
    supplierBankOut
  );

  return addMap(addMap(cashInOffice, chequesInHand), bankBalance);
}
