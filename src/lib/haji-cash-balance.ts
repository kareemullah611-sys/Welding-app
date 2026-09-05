import prisma from "@/lib/prisma";
import { formatSuperAdminBankLabel } from "@/lib/haji-transfer-detail";
import { getSuperAdminBankBalance } from "@/lib/settlement-validation";

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
  const balance = await getSuperAdminBankBalance(cashAccountId);
  return round2(balance?.balance || 0);
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
