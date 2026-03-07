import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { createSupplierSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const { page, limit, skip } = getPaginationParams(request.nextUrl.searchParams);
    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, skip, take: limit,
        include: { _count: { select: { lotPurchases: true, supplierPayments: true } } },
      }),
      prisma.supplier.count({ where: { isActive: true } }),
    ]);
    const formatted = suppliers.map((s) => ({
      id: s.id, name: s.name, country: s.country, contact: s.contact, notes: s.notes, isActive: s.isActive,
      totalPurchases: s._count.lotPurchases, totalPayments: s._count.supplierPayments,
    }));
    return paginatedResponse(formatted, total, page, limit);
  } catch (error) { console.error("List suppliers error:", error); return serverError(); }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const parsed = createSupplierSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid data", parsed.error.errors);
    const supplier = await prisma.supplier.create({ data: parsed.data });
    await createAuditLog(user.userId, null, "suppliers", supplier.id, "create", undefined, parsed.data, getClientIP(request));
    return successResponse({ id: supplier.id, name: supplier.name }, "Supplier created", 201);
  } catch (error) { console.error("Create supplier error:", error); return serverError(); }
});
