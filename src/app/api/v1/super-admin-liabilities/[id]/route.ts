import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = Number(context.params.id);
    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name) return validationError("Name is required");
    const existing = await prisma.superAdminLiabilityAccount.findUnique({ where: { id } });
    if (!existing) return errorResponse("NOT_FOUND", "Liability account not found", 404);
    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.superAdminLiabilityAccount.update({
        where: { id },
        data: {
          name,
          phone: body.phone ? String(body.phone).trim() : null,
          address: body.address ? String(body.address).trim() : null,
          notes: body.notes ? String(body.notes).trim() : null,
        },
      });
      await createAuditLog(user.userId, null, "super_admin_liability_accounts", id, "update", existing, row, getClientIP(request), tx);
      return row;
    });
    return successResponse({ id: updated.id }, "Liability account updated");
  } catch (error: any) {
    if (error?.code === "P2002") return errorResponse("DUPLICATE", "A liability account with this name already exists", 409);
    console.error("Update superadmin liability:", error);
    return serverError();
  }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = Number(context.params.id);
    const existing = await prisma.superAdminLiabilityAccount.findUnique({ where: { id }, include: { entries: true } });
    if (!existing) return errorResponse("NOT_FOUND", "Liability account not found", 404);
    const foreignBalance = existing.entries.reduce((sum, entry) => sum + Number(entry.liabilityEffect), 0);
    const pkrBalance = existing.entries.reduce((sum, entry) => sum + Number(entry.pkrLiabilityEffect), 0);
    if (Math.abs(foreignBalance) > 0.001 || Math.abs(pkrBalance) > 0.01) {
      return errorResponse("LIABILITY_BALANCE_REMAINS", "Settle or reverse the outstanding liability before deactivation", 409);
    }
    await prisma.$transaction(async (tx) => {
      await tx.superAdminLiabilityAccount.update({ where: { id }, data: { isActive: false } });
      await tx.account.update({ where: { id: existing.controlAccountId }, data: { isActive: false } });
      await createAuditLog(user.userId, null, "super_admin_liability_accounts", id, "delete", existing, { isActive: false }, getClientIP(request), tx);
    });
    return successResponse(null, "Liability account deactivated");
  } catch (error) {
    console.error("Deactivate superadmin liability:", error);
    return serverError();
  }
});
