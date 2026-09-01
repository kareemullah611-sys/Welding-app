import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload, comparePassword } from "@/lib/auth";

// DELETE /api/v1/customers/:id/hard-delete
// Super admin only — permanently removes an unused customer master record.
// Requires the super admin to supply their current password as 2FA confirmation.
export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Only super admin can permanently delete records", 403);

    const id = parseInt(context.params.id);
    const body = await request.json();
    if (!body.password) return validationError("Password confirmation is required");

    // 2FA: verify super admin password
    const admin = await prisma.user.findUnique({ where: { id: user.userId } });
    if (!admin) return errorResponse("NOT_FOUND", "Admin user not found", 404);
    const valid = await comparePassword(body.password, admin.passwordHash);
    if (!valid) return errorResponse("AUTH_FAILED", "Incorrect password", 401);

    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return errorResponse("NOT_FOUND", "Customer not found", 404);

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM customers WHERE id = ${id} FOR UPDATE`;
      const [sales, payments, openings] = await Promise.all([
        tx.sale.count({ where: { customerId: id } }),
        tx.payment.count({ where: { customerId: id } }),
        tx.openingCustomerBalance.count({ where: { customerId: id } }),
      ]);
      if (sales > 0 || payments > 0 || openings > 0) {
        throw Object.assign(new Error("Customer has accounting history"), { code: "CUSTOMER_HAS_ACCOUNTING_HISTORY" });
      }
      await tx.customer.delete({ where: { id } });
    });

    await createAuditLog(user.userId, customer.cityId, "customers", id, "hard_delete", { name: customer.name }, undefined, getClientIP(request));
    return successResponse({ id }, "Customer permanently deleted");
  } catch (error) {
    if ((error as any)?.code === "CUSTOMER_HAS_ACCOUNTING_HISTORY") {
      return errorResponse(
        "CUSTOMER_HAS_ACCOUNTING_HISTORY",
        "Customers with sales, payments, or opening balances cannot be permanently deleted. Deactivate the customer instead.",
        409,
      );
    }
    console.error("Hard delete customer error:", error);
    return serverError();
  }
});
