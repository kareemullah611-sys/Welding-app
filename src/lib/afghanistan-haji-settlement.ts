import type { PrismaClient } from "@prisma/client";

type Db = Pick<
  PrismaClient,
  "intermediary" | "superAdminBankAccount" | "cityCurrency"
>;

export type AfghanistanSettlementInput = {
  settlementDestination?: string | null;
  intermediaryId?: number | null;
  superAdminCashAccountId?: number | null;
  currencyId: number;
};

export type ResolvedAfghanistanSettlement = {
  settlementDestination: "intermediary" | "super_admin_cash";
  intermediaryId: number | null;
  superAdminCashAccountId: number | null;
  transferredTo: string;
};

export async function resolveAfghanistanSettlement(
  db: Db,
  input: AfghanistanSettlementInput
): Promise<{ ok: true; data: ResolvedAfghanistanSettlement } | { ok: false; message: string }> {
  const destination = String(input.settlementDestination || "").trim();
  if (destination !== "intermediary" && destination !== "super_admin_cash") {
    return { ok: false, message: "Select intermediary or super admin cash account" };
  }

  if (destination === "intermediary") {
    const intermediaryId = Number(input.intermediaryId || 0);
    if (!intermediaryId) return { ok: false, message: "Intermediary is required" };
    const intermediary = await db.intermediary.findUnique({
      where: { id: intermediaryId },
      select: { id: true, name: true, isActive: true },
    });
    if (!intermediary || !intermediary.isActive) {
      return { ok: false, message: "Selected intermediary is not available" };
    }
    return {
      ok: true,
      data: {
        settlementDestination: "intermediary",
        intermediaryId: intermediary.id,
        superAdminCashAccountId: null,
        transferredTo: intermediary.name,
      },
    };
  }

  const superAdminCashAccountId = Number(input.superAdminCashAccountId || 0);
  if (!superAdminCashAccountId) {
    return { ok: false, message: "Super admin cash account is required" };
  }
  const cashAccount = await db.superAdminBankAccount.findUnique({
    where: { id: superAdminCashAccountId },
    select: { id: true, bankName: true, currencyId: true, isActive: true, accountKind: true },
  });
  if (!cashAccount || !cashAccount.isActive) {
    return { ok: false, message: "Selected super admin cash account is not available" };
  }
  if (cashAccount.accountKind !== "cash") {
    return { ok: false, message: "Selected account is not a super admin cash account" };
  }
  if (cashAccount.currencyId !== input.currencyId) {
    return { ok: false, message: "Super admin cash account currency must match transfer currency" };
  }

  return {
    ok: true,
    data: {
      settlementDestination: "super_admin_cash",
      intermediaryId: null,
      superAdminCashAccountId: cashAccount.id,
      transferredTo: cashAccount.bankName,
    },
  };
}
