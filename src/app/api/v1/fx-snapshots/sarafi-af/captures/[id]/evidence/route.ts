import { NextRequest, NextResponse } from "next/server";
import { notFoundResponse, serverError, validationError } from "@/lib/api-response";
import { withSuperAdmin } from "@/lib/middleware";
import { getSarafiAfCaptureEvidence } from "@/lib/sarafi-af-assisted-capture-db";
import { getSarafiCaptureEvidenceUrl } from "@/lib/railway-bucket";

export const GET = withSuperAdmin(async (
  request: NextRequest,
  context: any,
) => {
  try {
    const id = Number(context.params.id);
    if (!Number.isInteger(id) || id <= 0) return validationError("Invalid capture draft ID");
    const type = request.nextUrl.searchParams.get("type");
    if (type !== "screenshot" && type !== "html") return validationError("Evidence type must be screenshot or html");
    const evidence = await getSarafiAfCaptureEvidence({ id, type });
    if (!evidence) return notFoundResponse("Capture draft not found");
    const url = await getSarafiCaptureEvidenceUrl(evidence);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("Open Sarafi.af capture evidence error:", error);
    return serverError();
  }
});
