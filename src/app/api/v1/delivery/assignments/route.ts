import { NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { deliveryCityScope } from "@/lib/delivery-guard";
import { assignSale, unassignSale, deliveryErrorResponse } from "@/lib/delivery-service";

/**
 * Hand a sale to the delivery party, or take it back.
 *
 * Assigning snapshots the sale's order lines so the party sees exactly what was
 * ordered at the moment of assignment. This is the only write in the module and it
 * changes no sale, stock or journal entry — a delivery never alters the books.
 */
export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  const scope = deliveryCityScope(user);
  if (!scope.ok) return errorResponse("FORBIDDEN", scope.message, 403);

  let body: { saleId?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "A JSON body is required");
  }

  const saleId = Number(body.saleId);
  if (!Number.isInteger(saleId) || saleId <= 0) return errorResponse("VALIDATION_ERROR", "A valid saleId is required");

  try {
    return successResponse(await assignSale(scope.cityId, saleId), "Sale assigned to the delivery party", 201);
  } catch (error) {
    const { code, message, status } = deliveryErrorResponse(error);
    return errorResponse(code, message, status);
  }
});

export const DELETE = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  const scope = deliveryCityScope(user);
  if (!scope.ok) return errorResponse("FORBIDDEN", scope.message, 403);

  let body: { saleId?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "A JSON body is required");
  }

  const saleId = Number(body.saleId);
  if (!Number.isInteger(saleId) || saleId <= 0) return errorResponse("VALIDATION_ERROR", "A valid saleId is required");

  try {
    return successResponse(await unassignSale(scope.cityId, saleId), "Sale unassigned");
  } catch (error) {
    const { code, message, status } = deliveryErrorResponse(error);
    return errorResponse(code, message, status);
  }
});
