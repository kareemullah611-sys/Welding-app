import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { journalLotCost } from "@/lib/accounting";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { createLotCostSchema } from "@/lib/validations";
import { successResponse, validationError, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta, isSyncRequestDuplicateError } from "@/lib/sync-idempotency";
import {
  resolveLotCostCurrency,
  resolveLotCostExchangeRate,
} from "@/lib/lot-cost-currency";
import { validateLotCostSettlement } from "@/lib/settlement-validation";
import { defaultLotCostAllocationBasis, type LotCostAllocationBasis } from "@/lib/lot-product-cost-allocation";

const LOT_COST_SYNC_MODULE = "lot_costs";
const SUPERADMIN_SYNC_CITY_ID = 0;

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
      allocationBasis: c.allocationBasis, allocatedProductId: c.allocatedProductId,
      amount: Number(c.amount), currencyCode: c.currencyCode,
      exchangeRate: c.exchangeRate ? Number(c.exchangeRate) : null,
      costDate: c.costDate?.toISOString().split("T")[0] || null, notes: c.notes,
    })));
  } catch (error) { return serverError(); }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
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
    const allocationBasis = (input.allocationBasis || defaultLotCostAllocationBasis(costType)) as LotCostAllocationBasis | null;
    if (!allocationBasis) return validationError("Select how this cost should be allocated across lot products");
    const allocatedProductId = input.allocatedProductId ? Number(input.allocatedProductId) : null;
    if (allocationBasis === "specific_product" && !allocatedProductId) return validationError("Select the product for this cost");
    if (allocationBasis !== "specific_product" && allocatedProductId) return validationError("A product may only be selected for product-specific allocation");
    if (allocatedProductId) {
      const lotProduct = await prisma.lotProduct.findUnique({
        where: { lotId_productId: { lotId: input.lotId, productId: allocatedProductId } },
        select: { id: true },
      });
      if (!lotProduct) return validationError("Selected product does not belong to this lot");
    }
    const isFreight = costType === "freight";
    const supplierId = input.supplierId ? Number(input.supplierId) : null;
    const agentId = input.agentId ? Number(input.agentId) : null;
    const shippingLineId = input.shippingLineId ? Number(input.shippingLineId) : null;
    const bankAccountId = input.bankAccountId ? Number(input.bankAccountId) : null;
    const superAdminBankAccountId = input.superAdminBankAccountId ? Number(input.superAdminBankAccountId) : null;
    const intermediaryId = input.intermediaryId ? Number(input.intermediaryId) : null;
    const paidFromCash = input.paidFromCash === true;
    const lotCountryCode = String(lot.country?.code || "").toUpperCase();

    if (paidFromCash) {
      return validationError("Cash / Direct debit channel is no longer allowed for lot costs. Use a bank account instead.");
    }

    const currencyResult = resolveLotCostCurrency({
      isFreight,
      lotCountryCode,
      requestedCurrency: input.currencyCode,
    });
    if (!currencyResult.ok) return validationError(currencyResult.message);
    const currencyCode = currencyResult.currencyCode;

    const rateResult = resolveLotCostExchangeRate({
      currencyCode,
      exchangeRate: input.exchangeRate ?? undefined,
    });
    if (!rateResult.ok) return validationError(rateResult.message);
    const exchangeRate = rateResult.exchangeRate;
    const costDate = input.costDate ? new Date(input.costDate) : new Date();
    if (Number.isNaN(costDate.getTime())) return validationError("Invalid cost date");
    const amountPkr = Number(new Prisma.Decimal(amount)
      .mul(currencyCode === "PKR" ? 1 : Number(exchangeRate))
      .toDecimalPlaces(2)
      .toString());

    if (isFreight) {
      if (!shippingLineId) return validationError("Shipping line is required for freight");
      if (supplierId || agentId || bankAccountId || superAdminBankAccountId || intermediaryId) {
        return validationError("Freight must be charged to a shipping line only");
      }
      const shippingLine = await prisma.shippingLine.findUnique({ where: { id: shippingLineId }, select: { id: true, isActive: true } });
      if (!shippingLine?.isActive) return errorResponse("NOT_FOUND", "Shipping line not found", 404);
    } else {
      if (shippingLineId) return validationError("Shipping line can only be used for freight costs");
      const sourceCount =
        Number(supplierId ? 1 : 0) +
        Number(agentId ? 1 : 0) +
        Number(bankAccountId ? 1 : 0) +
        Number(superAdminBankAccountId ? 1 : 0) +
        Number(intermediaryId ? 1 : 0);
      if (sourceCount > 1) return validationError("Choose exactly one debit channel: supplier, bank, intermediary, or agent");
      if (sourceCount === 0) return validationError("Please choose a debit channel for this cost");
      if (supplierId) {
        const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, isActive: true } });
        if (!supplier) return errorResponse("NOT_FOUND", "Supplier not found", 404);
        if (!supplier.isActive) return validationError("Selected supplier is inactive");
      }
      if (agentId) {
        const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, isActive: true } });
        if (!agent?.isActive) return errorResponse("NOT_FOUND", "Agent not found", 404);
      }
      if (superAdminBankAccountId) {
        const account = await prisma.superAdminBankAccount.findUnique({
          where: { id: superAdminBankAccountId },
          select: { id: true, isActive: true },
        });
        if (!account) return errorResponse("NOT_FOUND", "Super admin bank account not found", 404);
        if (!account.isActive) return validationError("Selected super admin bank account is inactive");
      }
      if (bankAccountId) {
        return validationError("City bank accounts are not allowed for lot costs. Use a super admin bank account.");
      }
    }

    if (superAdminBankAccountId || intermediaryId) {
      const settlement = await validateLotCostSettlement({
        amount,
        currencyCode,
        superAdminBankAccountId,
        intermediaryId,
        exchangeRate,
        liabilityCurrencyCode: currencyCode,
      });
      if (!settlement.ok) {
        return errorResponse(settlement.code, settlement.message, settlement.status || 400);
      }
    }

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: LOT_COST_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        return successResponse({ id: existingSync.entityId }, "Cost already synced");
      }
    }

    const cost = await prisma.$transaction(async (tx) => {
      const createdCost = await tx.lotCost.create({
        data: {
          lotId: input.lotId, costType: input.costType as any,
          allocationBasis: allocationBasis as any,
          allocatedProductId,
          description: input.description, amount,
          currencyCode,
          exchangeRate,
          costDate,
          supplierId,
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
        allocationBasis,
        allocatedProductId,
        amountPkr,
        originalAmount: amount,
        originalCurrencyCode: currencyCode,
        recognitionDate: costDate,
        journalVersion: createdCost.journalVersion,
        createdBy: user.userId,
        supplierId: supplierId || undefined,
        agentId: agentId || undefined,
        shippingLineId: shippingLineId || undefined,
        bankAccountId,
        superAdminBankAccountId,
        intermediaryId,
        paidFromCash,
      }, tx);
      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: LOT_COST_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "lot_costs",
            entityId: createdCost.id,
            createdBy: user.userId,
          },
        });
      }
      return createdCost;
    });

    return successResponse({ id: cost.id }, "Cost recorded", 201);
  } catch (error) {
    if (syncMeta && isSyncRequestDuplicateError(error)) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: {
          unique_sync_request_per_city_module: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: LOT_COST_SYNC_MODULE,
            requestId: syncMeta.requestId,
          },
        },
      });
      if (existingSync?.entityId) {
        return successResponse({ id: existingSync.entityId }, "Cost already synced");
      }
    }
    if (error instanceof Error && /quantity|sold|weight|allocation basis|specific product/i.test(error.message)) {
      return validationError(error.message);
    }
    console.error("Create lot cost error:", error);
    return serverError();
  }
});
