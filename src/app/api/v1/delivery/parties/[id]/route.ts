import { NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { deliveryCityScope } from "@/lib/delivery-guard";
import { setPartyUserActive, deliveryErrorResponse } from "@/lib/delivery-service";

/**
 * Activate or deactivate a party login.
 *
 * Deactivating blocks sign-in only. Recorded deliveries are physical evidence and
 * are kept, still attributed to that person.
 */
export const PATCH = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  const scope = deliveryCityScope(user);
  if (!scope.ok) return errorResponse("FORBIDDEN", scope.message, 403);

  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse("VALIDATION_ERROR", "Invalid user id");

  let body: { isActive?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "A JSON body is required");
  }
  if (typeof body.isActive !== "boolean") return errorResponse("VALIDATION_ERROR", "isActive must be true or false");

  try {
    return successResponse(await setPartyUserActive(scope.cityId, id, body.isActive));
  } catch (error) {
    const { code, message, status } = deliveryErrorResponse(error);
    return errorResponse(code, message, status);
  }
});
