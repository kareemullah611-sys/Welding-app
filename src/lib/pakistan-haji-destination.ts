import prisma from "@/lib/prisma";
import { formatSuperAdminBankLabel } from "@/lib/haji-transfer-detail";

export const PAKISTAN_HAJI_TARGET = "Super Admin Account";

export type PakistanHajiDestination = {
  superAdminBankAccountId?: number;
  superAdminCashAccountId?: number;
  settlementDestination?: "super_admin_cash";
};

/** Map Pakistan UI destination selection (or transferredTo label) to persisted account fields. */
export async function resolvePakistanDestinationAccount(
  superAdminDestinationAccountId?: number | null,
  transferredTo?: string | null,
): Promise<PakistanHajiDestination> {
  const id = Number(superAdminDestinationAccountId || 0);
  if (id) {
    const account = await prisma.superAdminBankAccount.findUnique({ where: { id } });
    if (!account?.isActive) return {};
    if (account.accountKind === "cash") {
      return {
        superAdminCashAccountId: account.id,
        settlementDestination: "super_admin_cash",
      };
    }
    return { superAdminBankAccountId: account.id };
  }

  const label = String(transferredTo || "").trim();
  if (!label || label === PAKISTAN_HAJI_TARGET) return {};
  const accounts = await prisma.superAdminBankAccount.findMany({ where: { isActive: true } });
  const match = accounts.find((account) => formatSuperAdminBankLabel(account) === label);
  if (!match) return {};
  if (match.accountKind === "cash") {
    return {
      superAdminCashAccountId: match.id,
      settlementDestination: "super_admin_cash",
    };
  }
  return { superAdminBankAccountId: match.id };
}

export async function transferredToLabelForPakistanDestination(
  destination: PakistanHajiDestination,
  fallback?: string | null,
): Promise<string> {
  const accountId = destination.superAdminBankAccountId || destination.superAdminCashAccountId;
  if (accountId) {
    const account = await prisma.superAdminBankAccount.findUnique({ where: { id: accountId } });
    if (account) return formatSuperAdminBankLabel(account);
  }
  const trimmed = String(fallback || "").trim();
  return trimmed || PAKISTAN_HAJI_TARGET;
}
