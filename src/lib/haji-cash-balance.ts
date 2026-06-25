import prisma from "@/lib/prisma";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export async function getSuperAdminCashAccount(accountId: number) {
  return prisma.superAdminBankAccount.findUnique({
    where: { id: accountId },
    include: { currency: true },
  });
}

export async function assertSuperAdminCashAccount(accountId: number) {
  const account = await getSuperAdminCashAccount(accountId);
  if (!account) return { ok: false as const, message: "Haji cash account not found" };
  if (!account.isActive) return { ok: false as const, message: "Haji cash account is inactive" };
  if (account.accountKind !== "cash") return { ok: false as const, message: "Selected account is not a haji cash account" };
  return { ok: true as const, account };
}

/** Running balance for a super-admin haji cash pot (single currency). */
export async function getSuperAdminCashAccountBalance(cashAccountId: number): Promise<number> {
  const checked = await assertSuperAdminCashAccount(cashAccountId);
  if (!checked.ok) return 0;
  const { account } = checked;
  const currencyId = account.currencyId;
  const currencyCode = String(account.currency.code || "").toUpperCase();

  const [
    hajiIn,
    receiptsIn,
    intermediaryOut,
    supplierPayments,
    agentPayments,
    shippingPayments,
  ] = await Promise.all([
    prisma.hajiTransfer.aggregate({
      where: {
        superAdminCashAccountId: cashAccountId,
        settlementDestination: "super_admin_cash",
        currencyId,
      },
      _sum: { amount: true },
    }),
    prisma.hajiCashReceipt.aggregate({
      where: { superAdminCashAccountId: cashAccountId, currencyId },
      _sum: { amount: true },
    }),
    prisma.intermediaryDeposit.aggregate({
      where: { superAdminCashAccountId: cashAccountId, currencyId },
      _sum: { amount: true },
    }),
    prisma.supplierPayment.findMany({
      where: { superAdminCashAccountId: cashAccountId },
      select: { amountLocal: true, amountUsd: true, exchangeRate: true },
    }),
    prisma.agentPayment.findMany({
      where: { superAdminCashAccountId: cashAccountId, currencyCode },
      select: { amount: true },
    }),
    prisma.shippingLinePayment.findMany({
      where: { superAdminCashAccountId: cashAccountId },
      select: { amountUsd: true, amountPkr: true, exchangeRate: true },
    }),
  ]);

  let out = Number(intermediaryOut._sum.amount || 0);
  for (const p of supplierPayments) {
    const local = Number(p.amountLocal || 0);
    out += local > 0 ? local : Number(p.amountUsd || 0);
  }
  for (const p of agentPayments) out += Number(p.amount || 0);
  for (const p of shippingPayments) {
    const local = Number(p.amountPkr || 0);
    out += local > 0 ? local : Number(p.amountUsd || 0);
  }

  const balance =
    Number(hajiIn._sum.amount || 0) +
    Number(receiptsIn._sum.amount || 0) -
    out;

  return round2(balance);
}

export async function assertSuperAdminCashHasFunds(cashAccountId: number, amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false as const, message: "Amount must be greater than 0" };
  }
  const balance = await getSuperAdminCashAccountBalance(cashAccountId);
  if (amount > balance + 0.0001) {
    return { ok: false as const, message: `Insufficient haji cash balance (${balance.toLocaleString("en-US")} available)` };
  }
  return { ok: true as const, balance };
}
