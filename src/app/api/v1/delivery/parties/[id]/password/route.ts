import { NextRequest } from "next/server";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { deliveryCityScope } from "@/lib/delivery-guard";
import { resetPartyPassword, deliveryErrorResponse } from "@/lib/delivery-service";

/**
 * Reset a party user's password.
 *
 * The admin chooses the new password rather than receiving a generated one, so it
 * has to travel: request body here, then the service call. It is never logged and
 * never stored — only its bcrypt hash reaches the database.
 *
 * Grants access to an account, which is why it is rate limited upstream and
 * confined to the caller's own city here.
 */
export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  const scope = deliveryCityScope(user);
  if (!scope.ok) return errorResponse("FORBIDDEN", scope.message, 403);

  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return errorResponse("VALIDATION_ERROR", "Invalid user id");

  let body: { newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "A JSON body is required");
  }

  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (!newPassword) return errorResponse("VALIDATION_ERROR", "A new password is required");
  if (newPassword.length < 10) {
    return errorResponse("VALIDATION_ERROR", "Password must be at least 10 characters");
  }

  try {
    return successResponse(await resetPartyPassword(scope.cityId, id, newPassword));
  } catch (error) {
    const { code, message, status } = deliveryErrorResponse(error);
    return errorResponse(code, message, status);
  }
});
