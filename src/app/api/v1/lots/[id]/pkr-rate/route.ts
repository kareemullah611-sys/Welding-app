import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// PUT /api/v1/lots/[id]/pkr-rate  — set USD/PKR exchange rate on a lot for profit calc
export const PUT = withSuperAdmin(async (request: NextRequest, context: any, _user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const rate = Number(body.pkrExchangeRate);
    if (!rate || rate <= 0) return validationError("pkrExchangeRate must be a positive number");

    const lot = await prisma.lot.findUnique({ where: { id } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    await prisma.lot.update({ where: { id }, data: { pkrExchangeRate: rate } as any });
    return successResponse({ id, pkrExchangeRate: rate }, "PKR exchange rate saved");
  } catch (error) { console.error("Set PKR rate:", error); return serverError(); }
});
