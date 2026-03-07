import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { createProductSchema } from "@/lib/validations";
import { successResponse, paginatedResponse, validationError, errorResponse, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const search = searchParams.get("search");
    const isActive = searchParams.get("is_active");

    const where: any = {};
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (isActive !== null && isActive !== undefined) where.isActive = isActive === "true";

    const [products, total] = await Promise.all([
      prisma.product.findMany({ where, orderBy: { name: "asc" }, skip, take: limit }),
      prisma.product.count({ where }),
    ]);

    return paginatedResponse(
      products.map((p) => ({ id: p.id, name: p.name, isActive: p.isActive })),
      total, page, limit
    );
  } catch (error) {
    return serverError();
  }
});

export const POST = withSuperAdmin(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const body = await request.json();
    const parsed = createProductSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid product data", parsed.error.errors);

    const existing = await prisma.product.findUnique({ where: { name: parsed.data.name } });
    if (existing) return errorResponse("DUPLICATE", "Product with this name already exists", 409);

    const product = await prisma.product.create({ data: { name: parsed.data.name } });
    await createAuditLog(user.userId, null, "products", product.id, "create", undefined, { name: product.name }, getClientIP(request));

    return successResponse({ id: product.id, name: product.name, isActive: product.isActive }, "Product created", 201);
  } catch (error) {
    return serverError();
  }
});
