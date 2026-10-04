import { NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import {
  fetchDeliveryParties,
  fetchDeliveryStatus,
  fetchSaleDetail,
  deliveryErrorResponse,
} from "@/lib/delivery-service";

/**
 * Read-only Delivery data for the signed-in admin's own city.
 *
 * The city comes from the verified JWT and is never read from the query string,
 * so a caller cannot widen their own scope by editing a parameter. See
 * lib/delivery-service for why this is proxied rather than called from the browser.
 */
export const GET = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "city_admin" || !user.cityId) {
    return errorResponse("FORBIDDEN", "Delivery is available to city admins", 403);
  }

  const saleIdParam = request.nextUrl.searchParams.get("sale_id");
  const cityId = user.cityId;

  try {
    if (saleIdParam) {
      const saleId = Number(saleIdParam);
      if (!Number.isInteger(saleId) || saleId <= 0) {
        return errorResponse("VALIDATION_ERROR", "sale_id must be a positive integer");
      }
      const detail = await fetchSaleDetail(cityId, saleId);
      return successResponse(detail);
    }

    const [status, parties] = await Promise.all([fetchDeliveryStatus(cityId), fetchDeliveryParties(cityId)]);
    return successResponse({ ...status, ...parties, cityId });
  } catch (error) {
    const { code, message, status } = deliveryErrorResponse(error);
    return errorResponse(code, message, status);
  }
});