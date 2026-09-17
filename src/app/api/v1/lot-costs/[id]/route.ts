import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { journalLotCost } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lot-cost:${id}`}::text)::bigint)`;
      const existing = await tx.lotCost.findUnique({ where: { id } });
      if (!existing) throw new Error("LOT_COST_NOT_FOUND");
      const nextAmount = body.amount !== undefined ? Number(body.amount) : Number(existing.amount);
      if (!Number.isFinite(nextAmount) || nextAmount <= 0) throw new Error("INVALID_AMOUNT");
      const nextExchangeRate = body.exchangeRate !== undefined ? Number(body.exchangeRate) : Number(existing.exchangeRate || 0);
      if (existing.currencyCode !== "PKR" && (!Number.isFinite(nextExchangeRate) || nextExchangeRate <= 0)) throw new Error("INVALID_EXCHANGE_RATE");
      const recognitionDate = new Date();
      const oldAmountPkr = Number(new Prisma.Decimal(existing.amount)
        .mul(existing.currencyCode === "PKR" ? 1 : Number(existing.exchangeRate || 0))
        .toDecimalPlaces(2)
        .toString());
      const newAmountPkr = Number(new Prisma.Decimal(nextAmount)
        .mul(existing.currencyCode === "PKR" ? 1 : nextExchangeRate)
        .toDecimalPlaces(2)
        .toString());
      const amountPkrDelta = Number(new Prisma.Decimal(newAmountPkr).minus(oldAmountPkr).toDecimalPlaces(2).toString());

      const updated = await tx.lotCost.update({
        where: { id },
        data: {
          description: body.description ?? existing.description,
          amount: nextAmount,
          exchangeRate: existing.currencyCode === "PKR" ? null : nextExchangeRate,
          notes: body.notes ?? existing.notes,
          journalVersion: { increment: 1 },
        },
      });

      if (amountPkrDelta !== 0) {
        await journalLotCost({
          id,
          lotId: existing.lotId,
          costType: existing.costType,
          allocationBasis: existing.allocationBasis as any,
          allocatedProductId: existing.allocatedProductId,
          amountPkr: amountPkrDelta,
          originalAmount: amountPkrDelta,
          originalCurrencyCode: "PKR",
          recognitionDate,
          journalVersion: updated.journalVersion,
          createdBy: user.userId,
          supplierId: (existing as any).supplierId || undefined,
          agentId: existing.agentId || undefined,
          shippingLineId: (existing as any).shippingLineId || undefined,
          bankAccountId: (existing as any).bankAccountId || null,
          superAdminBankAccountId: (existing as any).superAdminBankAccountId || null,
          intermediaryId: (existing as any).intermediaryId || null,
          paidFromCash: (existing as any).paidFromCash === true,
        }, tx);
      }

      await createAuditLog(user.userId, null, "lot_costs", id, "update",
        { amount: Number(existing.amount), description: existing.description },
        { amount: Number(updated.amount), description: updated.description }, getClientIP(request), tx);
    });

    return successResponse({ id }, "Cost updated");
  } catch (error) {
    if (error instanceof Error && error.message === "LOT_COST_NOT_FOUND") return errorResponse("NOT_FOUND", "Lot cost not found", 404);
    if (error instanceof Error && error.message === "INVALID_AMOUNT") return errorResponse("VALIDATION_ERROR", "Amount must be greater than 0", 400);
    if (error instanceof Error && error.message === "INVALID_EXCHANGE_RATE") return errorResponse("VALIDATION_ERROR", "A positive PKR exchange rate is required", 400);
    if (error instanceof Error && /quantity|sold|weight|allocation basis|specific product/i.test(error.message)) return errorResponse("VALIDATION_ERROR", error.message, 400);
    return serverError();
  }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lot-cost:${id}`}::text)::bigint)`;
      const existing = await tx.lotCost.findUnique({ where: { id } });
      if (!existing) throw new Error("LOT_COST_NOT_FOUND");
      const currentAmountPkr = Number(new Prisma.Decimal(existing.amount)
        .mul(existing.currencyCode === "PKR" ? 1 : Number(existing.exchangeRate || 0))
        .toDecimalPlaces(2)
        .toString());
      const versioned = await tx.lotCost.update({
        where: { id },
        data: { journalVersion: { increment: 1 } },
      });
      await journalLotCost({
        id,
        lotId: existing.lotId,
        costType: existing.costType,
        allocationBasis: existing.allocationBasis as any,
        allocatedProductId: existing.allocatedProductId,
        amountPkr: -currentAmountPkr,
        originalAmount: -currentAmountPkr,
        originalCurrencyCode: "PKR",
        recognitionDate: new Date(),
        journalVersion: versioned.journalVersion,
        createdBy: user.userId,
        supplierId: (existing as any).supplierId || undefined,
        agentId: existing.agentId || undefined,
        shippingLineId: (existing as any).shippingLineId || undefined,
        bankAccountId: (existing as any).bankAccountId || null,
        superAdminBankAccountId: (existing as any).superAdminBankAccountId || null,
        intermediaryId: (existing as any).intermediaryId || null,
        paidFromCash: (existing as any).paidFromCash === true,
      }, tx);
      await tx.lotCost.delete({ where: { id } });
      await createAuditLog(user.userId, null, "lot_costs", id, "delete",
        { amount: Number(existing.amount), costType: existing.costType, lotId: existing.lotId },
        undefined, getClientIP(request), tx);
    });

    return successResponse({ id }, "Cost deleted");
  } catch (error) {
    if (error instanceof Error && error.message === "LOT_COST_NOT_FOUND") return errorResponse("NOT_FOUND", "Lot cost not found", 404);
    if (error instanceof Error && /quantity|sold|weight|allocation basis|specific product/i.test(error.message)) return errorResponse("VALIDATION_ERROR", error.message, 400);
    return serverError();
  }
});
