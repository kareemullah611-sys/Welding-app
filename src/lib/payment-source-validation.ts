import prisma from "@/lib/prisma";

type SourceValidationArgs = {
  bankAccountId?: unknown;
  intermediaryId?: unknown;
  cityId?: number | null;
  requireSelection?: boolean;
};

type SourceValidationResult =
  | {
      ok: true;
      bankAccountId: number | null;
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
  intermediaryId,
  cityId,
  requireSelection = false,
}: SourceValidationArgs): Promise<SourceValidationResult> {
  const normalizedBankAccountId = normalizeOptionalId(bankAccountId);
  const normalizedIntermediaryId = normalizeOptionalId(intermediaryId);

  if (Number.isNaN(normalizedBankAccountId) || Number.isNaN(normalizedIntermediaryId)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Funding source selection is invalid" };
  }

  if (normalizedBankAccountId && normalizedIntermediaryId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Choose either a bank account or an intermediary, not both" };
  }

  if (requireSelection && !normalizedBankAccountId && !normalizedIntermediaryId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "A funding source is required" };
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
    intermediaryId: normalizedIntermediaryId,
  };
}
