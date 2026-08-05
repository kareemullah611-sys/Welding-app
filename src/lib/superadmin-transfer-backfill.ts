import { formatSuperAdminBankLabel } from "@/lib/haji-transfer-detail";

export type SuperAdminTransferTarget = {
  bankId?: number;
  cashId?: number;
};

/**
 * Resolve the super admin account a legacy haji transfer belongs to by its
 * `transferredTo` label. Returns a single unambiguous match only; ambiguous or
 * no-match rows return null and are left untouched.
 */
export function resolveLegacyTransferTarget(
  transferredTo: string | null | undefined,
  accounts: Array<{ id: number; bankName: string; accountNumber?: string | null; accountKind?: string | null }>
): SuperAdminTransferTarget | null {
  const label = String(transferredTo || "").trim();
  if (!label) return null;
  const matches = accounts.filter((a) => formatSuperAdminBankLabel(a) === label);
  if (matches.length !== 1) return null;
  const account = matches[0];
  return account.accountKind === "cash" ? { cashId: account.id } : { bankId: account.id };
}
