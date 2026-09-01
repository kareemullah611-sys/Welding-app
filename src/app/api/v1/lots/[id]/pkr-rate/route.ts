import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// PUT /api/v1/lots/[id]/pkr-rate  — set USD/PKR exchange rate on a lot for profit calc
export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const rate = Number(body.pkrExchangeRate);
    const reason = String(body.reason || "").trim();
    const confirmation = String(body.confirmation || "").trim();
    if (!rate || rate <= 0) return validationError("pkrExchangeRate must be a positive number");
    if (reason.length < 5) return validationError("A correction reason of at least 5 characters is required");
    if (confirmation !== "UPDATE HISTORICAL RATE") return validationError("Type UPDATE HISTORICAL RATE to confirm");

    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", "investor-finalization-timeline");
      const lot = await tx.lot.findUnique({ where: { id } });
      if (!lot) throw new Error("LOT_NOT_FOUND");
      const finalizedPeriod = await tx.profitAttributionPeriod.findFirst({
        where: {
          status: "finalized",
          periodStart: { lte: lot.lotDate },
          periodEnd: { gte: lot.lotDate },
        },
        select: { id: true },
      });
      if (finalizedPeriod) throw new Error("FINALIZED_PERIOD");
      const previousMetadata = (lot as any).pkrExchangeRateMetadata || null;
      const nextMetadata = {
        ok: true,
        provider: "MANUAL_HISTORICAL_REMEDIATION",
        market: "manual_correction",
        rate,
        selectedRateType: "reference",
        businessAdjustmentPkr: 0,
        transactionDate: lot.lotDate.toISOString().slice(0, 10),
        rateSourceDate: lot.lotDate.toISOString().slice(0, 10),
        daysCarriedBackward: 0,
        providerReference: null,
        reason: "AUTHORIZED_MANUAL_CORRECTION",
        correctionReason: reason,
        correctedAt: new Date().toISOString(),
        correctedBy: user.userId,
        previousMetadata,
      };
      await tx.lot.update({
        where: { id },
        data: { pkrExchangeRate: rate, pkrExchangeRateMetadata: nextMetadata } as any,
      });
      await createAuditLog(user.userId, null, "lots", id, "update", {
        pkrExchangeRate: lot.pkrExchangeRate ? Number(lot.pkrExchangeRate) : null,
        pkrExchangeRateMetadata: previousMetadata,
      }, {
        pkrExchangeRate: rate,
        pkrExchangeRateMetadata: nextMetadata,
        reason,
      }, getClientIP(request), tx);
      return { nextMetadata };
    });
    return successResponse({ id, pkrExchangeRate: rate, pkrExchangeRateMetadata: result.nextMetadata }, "PKR exchange rate saved");
  } catch (error) {
    if (error instanceof Error && error.message === "LOT_NOT_FOUND") return errorResponse("NOT_FOUND", "Lot not found", 404);
    if (error instanceof Error && error.message === "FINALIZED_PERIOD") return errorResponse("FINALIZED_PERIOD", "This rate is covered by a finalized investor period. Reverse/correct the finalization before changing historical evidence.", 409);
    console.error("Set PKR rate:", error);
    return serverError();
  }
});
