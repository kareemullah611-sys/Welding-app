import crypto from "node:crypto";
import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, paginatedResponse, serverError, successResponse, validationError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

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
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const partyType = String(body.partyType || "");
    if (!name) return validationError("Name is required");
    if (!new Set(["lender", "creditor"]).has(partyType)) return validationError("Party type must be lender or creditor");

    const created = await prisma.$transaction(async (tx) => {
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
      return account;
    });
    return successResponse({ id: created.id }, partyType === "lender" ? "Lender created" : "Creditor created", 201);
  } catch (error: any) {
    if (error?.code === "P2002") return errorResponse("DUPLICATE", "A liability account with this name already exists", 409);
    console.error("Create superadmin liability:", error);
    return serverError();
  }
});
