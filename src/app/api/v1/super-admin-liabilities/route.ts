import crypto from "node:crypto";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, paginatedResponse, serverError, successResponse, validationError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { getSyncRequestMeta } from "@/lib/sync-idempotency";

const SUPER_ADMIN_LIABILITY_ACCOUNT_SYNC_MODULE = "super_admin_liability_accounts.create";
const SUPERADMIN_SYNC_CITY_ID = 0;

export const GET = withSuperAdmin(async (request: NextRequest) => {
  try {
    const { page, limit, skip } = getPaginationParams(request.nextUrl.searchParams);
    const partyType = request.nextUrl.searchParams.get("partyType");
    const where: any = { ...(partyType ? { partyType } : {}) };
    const [accounts, total] = await Promise.all([
      prisma.superAdminLiabilityAccount.findMany({
        where,
        include: {
          entries: { select: { currencyId: true, liabilityEffect: true, pkrLiabilityEffect: true, currency: { select: { code: true } } } },
        },
        orderBy: [{ isActive: "desc" }, { name: "asc" }],
        skip,
        take: limit,
      }),
      prisma.superAdminLiabilityAccount.count({ where }),
    ]);
    return paginatedResponse(accounts.map((account) => {
      const balancesByCurrency: Record<string, number> = {};
      let balancePkr = 0;
      for (const entry of account.entries) {
        const code = entry.currency.code;
        balancesByCurrency[code] = Math.round(((balancesByCurrency[code] || 0) + Number(entry.liabilityEffect)) * 100) / 100;
        balancePkr += Number(entry.pkrLiabilityEffect);
      }
      return {
        id: account.id,
        name: account.name,
        partyType: account.partyType,
        phone: account.phone,
        address: account.address,
        notes: account.notes,
        isActive: account.isActive,
        balancesByCurrency,
        balancePkr: Math.round(balancePkr * 100) / 100,
      };
    }), total, page, limit);
  } catch (error) {
    console.error("List superadmin liabilities:", error);
    return serverError();
  }
});

export const POST = withSuperAdmin(async (request: NextRequest, _context: unknown, user: JWTPayload) => {
  const syncMeta = getSyncRequestMeta(request);
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const partyType = String(body.partyType || "");
    if (!name) return validationError("Name is required");
    if (!new Set(["lender", "creditor"]).has(partyType)) return validationError("Party type must be lender or creditor");

    if (syncMeta) {
      const existingSync = await prisma.syncRequest.findUnique({
        where: { unique_sync_request_per_city_module: { cityId: SUPERADMIN_SYNC_CITY_ID, module: SUPER_ADMIN_LIABILITY_ACCOUNT_SYNC_MODULE, requestId: syncMeta.requestId } },
      });
      if (existingSync?.entityId) return successResponse({ id: existingSync.entityId }, "Liability account already created");
    }

    const result = await prisma.$transaction(async (tx) => {
      if (syncMeta) {
        await tx.$executeRawUnsafe(
          "SELECT pg_advisory_xact_lock(hashtext($1)::bigint)",
          `sync:${SUPERADMIN_SYNC_CITY_ID}:${SUPER_ADMIN_LIABILITY_ACCOUNT_SYNC_MODULE}:${syncMeta.requestId}`,
        );
        const existingSync = await tx.syncRequest.findUnique({
          where: { unique_sync_request_per_city_module: { cityId: SUPERADMIN_SYNC_CITY_ID, module: SUPER_ADMIN_LIABILITY_ACCOUNT_SYNC_MODULE, requestId: syncMeta.requestId } },
        });
        if (existingSync?.entityId) return { id: existingSync.entityId, duplicate: true };
      }
      const controlAccount = await tx.account.create({
        data: {
          code: `2400-${partyType === "lender" ? "L" : "C"}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
          name: `${partyType === "lender" ? "Loan Payable" : "Other Payable"} - ${name}`,
          accountType: "liability",
          isSystem: true,
        },
      });
      const account = await tx.superAdminLiabilityAccount.create({
        data: {
          name,
          partyType: partyType as any,
          phone: body.phone ? String(body.phone).trim() : null,
          address: body.address ? String(body.address).trim() : null,
          notes: body.notes ? String(body.notes).trim() : null,
          controlAccountId: controlAccount.id,
          createdBy: user.userId,
        },
      });
      await createAuditLog(user.userId, null, "super_admin_liability_accounts", account.id, "create", undefined, { name, partyType }, getClientIP(request), tx);
      if (syncMeta) {
        await tx.syncRequest.create({
          data: {
            cityId: SUPERADMIN_SYNC_CITY_ID,
            module: SUPER_ADMIN_LIABILITY_ACCOUNT_SYNC_MODULE,
            requestId: syncMeta.requestId,
            deviceId: syncMeta.deviceId,
            entityType: "super_admin_liability_accounts",
            entityId: account.id,
            createdBy: user.userId,
          },
        });
      }
      return { id: account.id, duplicate: false };
    });
    return successResponse(
      { id: result.id },
      result.duplicate ? "Liability account already created" : partyType === "lender" ? "Lender created" : "Creditor created",
      result.duplicate ? 200 : 201,
    );
  } catch (error: any) {
    if (error?.code === "P2002") return errorResponse("DUPLICATE", "A liability account with this name already exists", 409);
    console.error("Create superadmin liability:", error);
    return serverError();
  }
});
