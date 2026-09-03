import { NextRequest } from "next/server";
import { errorResponse, serverError, successResponse } from "@/lib/api-response";
import { purgeExpiredFxEvidence } from "@/lib/fx-evidence-retention";
import { isValidDailyFxCaptureToken } from "@/lib/sbp-daily-fx";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!isValidDailyFxCaptureToken(request.headers.get("x-daily-fx-capture-token"))) {
      return errorResponse("UNAUTHORIZED", "Invalid daily FX capture token", 401);
    }
    return successResponse(await purgeExpiredFxEvidence(), "Expired FX evidence deleted; immutable rate records were preserved");
  } catch (error) {
    console.error("FX evidence retention cleanup error:", error);
    return serverError();
  }
}
