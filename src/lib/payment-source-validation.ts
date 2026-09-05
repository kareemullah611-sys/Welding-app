import prisma from "@/lib/prisma";

type SourceValidationArgs = {
  bankAccountId?: unknown;
  superAdminBankAccountId?: unknown;
  superAdminCashAccountId?: unknown;
  intermediaryId?: unknown;
  cityId?: number | null;
  currencyCode?: string | null;
  requireSelection?: boolean;
};

type SourceValidationResult =
  | {
      ok: true;
      bankAccountId: number | null;
      superAdminBankAccountId: number | null;
      superAdminCashAccountId: number | null;
      intermediaryId: number | null;
    }
  | {
      ok: false;
      code: string;
      message: string;
      status?: number;
    };

function normalizeOptionalId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

export async function validatePaymentSource({
  bankAccountId,
  superAdminBankAccountId,
  superAdminCashAccountId,
  intermediaryId,
  cityId,
  currencyCode,
  requireSelection = false,
}: SourceValidationArgs): Promise<SourceValidationResult> {
  const normalizedBankAccountId = normalizeOptionalId(bankAccountId);
  const normalizedSuperAdminBankAccountId = normalizeOptionalId(superAdminBankAccountId);
  const normalizedSuperAdminCashAccountId = normalizeOptionalId(superAdminCashAccountId);
  const normalizedIntermediaryId = normalizeOptionalId(intermediaryId);

  if ([normalizedBankAccountId, normalizedSuperAdminBankAccountId, normalizedSuperAdminCashAccountId, normalizedIntermediaryId].some(Number.isNaN)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Funding source selection is invalid" };
  }

  const sourceCount = [normalizedBankAccountId, normalizedSuperAdminBankAccountId, normalizedSuperAdminCashAccountId, normalizedIntermediaryId].filter(Boolean).length;
  if (sourceCount > 1) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Choose exactly one funding source" };
  }

  if (requireSelection && sourceCount === 0) {
    return { ok: false, code: "VALIDATION_ERROR", message: "A funding source is required" };
  }

  const normalizedCurrencyCode = String(currencyCode || "").trim().toUpperCase();
  const superAdminAccountId = normalizedSuperAdminBankAccountId || normalizedSuperAdminCashAccountId;
  if (superAdminAccountId) {
    const account = await prisma.superAdminBankAccount.findUnique({
      where: { id: superAdminAccountId },
      include: { currency: { select: { code: true } } },
    });
    if (!account) return { ok: false, code: "NOT_FOUND", message: "Super admin account not found", status: 404 };
    if (!account.isActive) return { ok: false, code: "VALIDATION_ERROR", message: "Selected super admin account is inactive" };
    const expectedKind = normalizedSuperAdminCashAccountId ? "cash" : "bank";
    if (account.accountKind !== expectedKind) return { ok: false, code: "VALIDATION_ERROR", message: `Selected account is not a super admin ${expectedKind} account` };
    if (normalizedCurrencyCode && String(account.currency.code).toUpperCase() !== normalizedCurrencyCode) {
      return { ok: false, code: "CURRENCY_MISMATCH", message: "Funding account currency must match the transaction currency; record an exchange first" };
    }
  }

  if (normalizedBankAccountId) {
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: normalizedBankAccountId },
      select: { id: true, cityId: true, isActive: true },
    });
    if (!bankAccount) {
      return { ok: false, code: "NOT_FOUND", message: "Bank account not found", status: 404 };
    }
    if (!bankAccount.isActive) {
      return { ok: false, code: "VALIDATION_ERROR", message: "Selected bank account is inactive" };
    }
    if (cityId && bankAccount.cityId !== cityId) {
      return { ok: false, code: "FORBIDDEN", message: "Selected bank account does not belong to the selected city", status: 403 };
    }
  }

  if (normalizedIntermediaryId) {
    const intermediary = await prisma.intermediary.findUnique({
      where: { id: normalizedIntermediaryId },
      select: { id: true, isActive: true },
    });
    if (!intermediary) {
      return { ok: false, code: "NOT_FOUND", message: "Intermediary not found", status: 404 };
    }
    if (!intermediary.isActive) {
      return { ok: false, code: "VALIDATION_ERROR", message: "Selected intermediary is inactive" };
    }
  }

  return {
    ok: true,
    bankAccountId: normalizedBankAccountId,
    superAdminBankAccountId: normalizedSuperAdminBankAccountId,
    superAdminCashAccountId: normalizedSuperAdminCashAccountId,
    intermediaryId: normalizedIntermediaryId,
  };
}
