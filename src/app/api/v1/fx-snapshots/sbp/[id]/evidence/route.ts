import { NextRequest, NextResponse } from "next/server";
import { errorResponse, serverError } from "@/lib/api-response";
import { withSuperAdmin } from "@/lib/middleware";
import { getSbpDailyFxEvidence } from "@/lib/sbp-daily-fx-db";
import { getSarafiCaptureEvidenceUrl } from "@/lib/railway-bucket";

export const runtime = "nodejs";

export const GET = withSuperAdmin(async (request: NextRequest, context: any) => {
  try {
    const id = Number(context.params.id);
    const type = request.nextUrl.searchParams.get("type") === "html" ? "html" : "screenshot";
    const evidence = await getSbpDailyFxEvidence({ id, type });
    if (!evidence) return errorResponse("NOT_FOUND", "SBP source evidence has expired or does not exist", 404);
    const url = await getSarafiCaptureEvidenceUrl(evidence);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("Open SBP daily FX evidence error:", error);
    return serverError();
  }
});
