import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { journalLotCost } from "@/lib/accounting";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { createLotCostSchema } from "@/lib/validations";
import { successResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { validatePaymentSource } from "@/lib/payment-source-validation";

export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const lotId = request.nextUrl.searchParams.get("lot_id") ? parseInt(request.nextUrl.searchParams.get("lot_id")!) : undefined;
    const where: any = {};
    if (lotId) where.lotId = lotId;

    const costs = await prisma.lotCost.findMany({
      where, include: { lot: { select: { id: true, lotNumber: true } } }, orderBy: { createdAt: "desc" },
    });

    return successResponse(costs.map((c) => ({
      id: c.id, lotId: c.lotId, lotNumber: c.lot.lotNumber,
      costType: c.costType, description: c.description,
      amount: Number(c.amount), currencyCode: c.currencyCode,
      exchangeRate: c.exchangeRate ? Number(c.exchangeRate) : null,
      costDate: c.costDate?.toISOString().split("T")[0] || null, notes: c.notes,
    })));
  } catch (error) { return serverError(); }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const parsed = createLotCostSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid lot cost data", parsed.error.errors);
    const input = parsed.data;

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return validationError("Amount must be greater than 0");

    const lot = await prisma.lot.findUnique({
      where: { id: input.lotId },
      include: { country: { select: { code: true, name: true } } },
    });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    const costType = String(input.costType || "");
    const isFreight = costType === "freight";
    const agentId = input.agentId ? Number(input.agentId) : null;
    const shippingLineId = input.shippingLineId ? Number(input.shippingLineId) : null;
    const bankAccountId = input.bankAccountId ? Number(input.bankAccountId) : null;
    const superAdminBankAccountId = input.superAdminBankAccountId ? Number(input.superAdminBankAccountId) : null;
    const intermediaryId = input.intermediaryId ? Number(input.intermediaryId) : null;
    const paidFromCash = input.paidFromCash === true;
    const requestedCurrency = String(input.currencyCode || "").toUpperCase();
    const lotCountryCode = String(lot.country?.code || "").toUpperCase();
    const nonFreightCurrency = lotCountryCode === "AFG" ? "AFN" : "PKR";

    // Business rule:
    // - Freight is entered in USD and must carry a costing exchange rate (USD→PKR)
    // - Non-freight follows lot country:
    //   - Pakistan lots: PKR
    //   - Afghanistan lots: AFN (+ AFN→PKR rate for PKR reporting)
    const currencyCode = isFreight ? "USD" : nonFreightCurrency;
    let exchangeRate: number | null = null;
    if (isFreight) {
      if (requestedCurrency && requestedCurrency !== "USD") {
        return validationError("Freight must be recorded in USD");
      }
      const parsedRate = Number(input.exchangeRate);
      if (!Number.isFinite(parsedRate) || parsedRate <= 0) {
        return validationError("Costing exchange rate is required for freight");
      }
      exchangeRate = parsedRate;
    } else {
      if (requestedCurrency && requestedCurrency !== nonFreightCurrency) {
        return validationError(`Only freight can be USD. Non-freight costs for ${lot.country?.name || "this lot"} must be in ${nonFreightCurrency}`);
      }
      if (nonFreightCurrency === "AFN") {
        const afnToPkrRate = Number(input.exchangeRate);
        if (!Number.isFinite(afnToPkrRate) || afnToPkrRate <= 0) {
          return validationError("AFN→PKR exchange rate is required for Afghanistan non-freight costs");
        }
        exchangeRate = afnToPkrRate;
      }
    }

    if (isFreight) {
      if (!shippingLineId) return validationError("Shipping line is required for freight");
      if (agentId || bankAccountId || superAdminBankAccountId || intermediaryId || paidFromCash) {
        return validationError("Freight must be charged to a shipping line only");
      }
      const shippingLine = await prisma.shippingLine.findUnique({ where: { id: shippingLineId }, select: { id: true, isActive: true } });
      if (!shippingLine?.isActive) return errorResponse("NOT_FOUND", "Shipping line not found", 404);
    } else {
      if (shippingLineId) return validationError("Shipping line can only be used for freight costs");
      const sourceCount =
        Number(agentId ? 1 : 0) +
        Number(bankAccountId ? 1 : 0) +
        Number(superAdminBankAccountId ? 1 : 0) +
        Number(intermediaryId ? 1 : 0) +
        Number(paidFromCash ? 1 : 0);
      if (sourceCount > 1) return validationError("Choose exactly one debit channel: cash, bank, intermediary, or agent");
      if (sourceCount === 0) return validationError("Please choose a debit channel for this cost");
      if (agentId) {
        const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, isActive: true } });
        if (!agent?.isActive) return errorResponse("NOT_FOUND", "Agent not found", 404);
      }
      if (bankAccountId || intermediaryId) {
        const source = await validatePaymentSource({
          bankAccountId,
          intermediaryId,
          requireSelection: true,
        });
        if (!source.ok) {
          return errorResponse(source.code, source.message, source.status || 400);
        }
      }
      if (superAdminBankAccountId) {
        const account = await prisma.superAdminBankAccount.findUnique({
          where: { id: superAdminBankAccountId },
          select: { id: true, isActive: true },
        });
        if (!account) return errorResponse("NOT_FOUND", "Super admin bank account not found", 404);
        if (!account.isActive) return validationError("Selected super admin bank account is inactive");
      }
    }

    const cost = await prisma.$transaction(async (tx) => {
      const createdCost = await tx.lotCost.create({
        data: {
          lotId: input.lotId, costType: input.costType as any,
          description: input.description, amount,
          currencyCode,
          exchangeRate,
          costDate: input.costDate ? new Date(input.costDate) : null,
          agentId,
          shippingLineId,
          bankAccountId,
          superAdminBankAccountId,
          intermediaryId,
          paidFromCash,
          notes: input.notes || null, createdBy: user.userId,
        },
      });

      await createAuditLog(user.userId, null, "lot_costs", createdCost.id, "create", undefined, input, getClientIP(request), tx);
      await journalLotCost({
        id: createdCost.id,
        lotId: input.lotId,
        costType: input.costType,
        amount,
        currencyCode,
        createdBy: user.userId,
        agentId: agentId || undefined,
        shippingLineId: shippingLineId || undefined,
        bankAccountId,
        superAdminBankAccountId,
        intermediaryId,
        paidFromCash,
      }, tx);
      return createdCost;
    });

    return successResponse({ id: cost.id }, "Cost recorded", 201);
  } catch (error) { console.error("Create lot cost error:", error); return serverError(); }
});
