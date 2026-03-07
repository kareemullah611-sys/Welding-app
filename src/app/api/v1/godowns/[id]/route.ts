import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const godown = await prisma.godown.findUnique({ where: { id }, include: { city: true } });
    if (!godown) return errorResponse("NOT_FOUND", "Godown not found", 404);
    if (user.role === "city_admin" && godown.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);
    return successResponse({ id: godown.id, name: godown.name, cityId: godown.cityId, cityName: godown.city.name, isActive: godown.isActive });
  } catch (error) { return serverError(); }
});

export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const godown = await prisma.godown.findUnique({ where: { id } });
    if (!godown) return errorResponse("NOT_FOUND", "Godown not found", 404);
    if (user.role === "city_admin" && godown.cityId !== user.cityId) return errorResponse("FORBIDDEN", "Not your city", 403);

    const updated = await prisma.godown.update({ where: { id }, data: { name: body.name || godown.name, isActive: body.isActive !== undefined ? body.isActive : godown.isActive, updatedAt: new Date() } });
    await createAuditLog(user.userId, godown.cityId, "godowns", id, "update", { name: godown.name }, { name: updated.name }, getClientIP(request));
    return successResponse({ id: updated.id, name: updated.name }, "Godown updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const godown = await prisma.godown.findUnique({ where: { id } });
    if (!godown) return errorResponse("NOT_FOUND", "Godown not found", 404);
    if (godown.isActive) return errorResponse("FORBIDDEN", "Deactivate godown before deleting", 403);
    // Check stock
    const stock = await prisma.lotCityGodownAllocation.aggregate({ where: { godownId: id }, _sum: { qty: true } });
    if (Number(stock._sum.qty || 0) > 0) return errorResponse("FORBIDDEN", "Godown has stock allocated, cannot delete", 403);
    await prisma.godown.delete({ where: { id } });
    return successResponse({ id }, "Godown deleted");
  } catch (error) { return serverError(); }
});
