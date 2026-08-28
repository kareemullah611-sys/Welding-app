import { NextRequest } from "next/server";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { withSuperAdmin } from "@/lib/middleware";
import { reviewSarafiAfCaptureDraft } from "@/lib/sarafi-af-assisted-capture-db";

export const PATCH = withSuperAdmin(async (
  request: NextRequest,
  context: any,
  user: JWTPayload,
) => {
  try {
    const id = Number(context.params.id);
    if (!Number.isInteger(id) || id <= 0) return validationError("Invalid capture draft ID");
    const body = await request.json();
    const action = String(body?.action || "").toLowerCase();
    if (action !== "approve" && action !== "reject") return validationError("Action must be approve or reject");
    const result = await reviewSarafiAfCaptureDraft({
      id,
      action,
      reviewedBy: user.userId,
      reviewNotes: body?.reviewNotes ? String(body.reviewNotes).trim() : null,
    });
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "INVALID_STATUS" ? 409 : 400;
      return errorResponse(result.code, result.message, status, "warnings" in result ? [{ warnings: result.warnings }] : undefined);
    }
    return successResponse(
      { capture: result.draft, snapshotId: result.snapshotId },
      action === "approve" ? "Capture approved and immutable FX snapshot created" : "Capture rejected",
    );
  } catch (error) {
    console.error("Review Sarafi.af assisted capture error:", error);
    return serverError();
  }
});
