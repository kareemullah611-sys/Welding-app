import { NextRequest } from "next/server";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { withSuperAdmin } from "@/lib/middleware";
import { createSbpDailyFxSnapshot, listSbpDailyFxSnapshots } from "@/lib/sbp-daily-fx-db";
import { extractPdfText, isSbpDailyRateCurrent, isValidDailyFxCaptureToken, parseSbpOpenMarketClosingText } from "@/lib/sbp-daily-fx";
import { createFxEvidenceStorageKey, deleteBucketObject, uploadFxCaptureEvidence } from "@/lib/railway-bucket";

export const runtime = "nodejs";
const MAX_PDF_BYTES = 5 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

export const GET = withSuperAdmin(async (request: NextRequest) => {
  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") || 30);
    return successResponse({ snapshots: await listSbpDailyFxSnapshots(limit) });
  } catch (error) {
    console.error("List SBP daily FX snapshots error:", error);
    return serverError();
  }
});

export async function POST(request: NextRequest) {
  const uploadedKeys: string[] = [];
  try {
    if (!isValidDailyFxCaptureToken(request.headers.get("x-daily-fx-capture-token"))) {
      return errorResponse("UNAUTHORIZED", "Invalid daily FX capture token", 401);
    }
    const formData = await request.formData();
    const rawPdfFile = formData.get("rawPdf");
    const screenshotFile = formData.get("screenshot");
    if (!(rawPdfFile instanceof File) || !(screenshotFile instanceof File)) return validationError("Official PDF and screenshot evidence are required");
    if (rawPdfFile.size <= 0 || rawPdfFile.size > MAX_PDF_BYTES || rawPdfFile.type !== "application/pdf") return validationError("Official PDF evidence is invalid");
    if (screenshotFile.size <= 0 || screenshotFile.size > MAX_SCREENSHOT_BYTES || !String(screenshotFile.type).startsWith("image/png")) {
      return validationError("Screenshot evidence must be a valid PNG");
    }
    const fetchedAt = new Date(String(formData.get("fetchedAt") || ""));
    if (!Number.isFinite(fetchedAt.getTime()) || Math.abs(Date.now() - fetchedAt.getTime()) > 12 * 60 * 60 * 1000) {
      return validationError("Capture timestamp is missing or outside the allowed window");
    }
    const sourceUrl = String(formData.get("sourceUrl") || "");
    const rawPdfBuffer = Buffer.from(await rawPdfFile.arrayBuffer());
    const screenshotBuffer = Buffer.from(await screenshotFile.arrayBuffer());
    const text = await extractPdfText(new Uint8Array(rawPdfBuffer));
    const parsed = parseSbpOpenMarketClosingText({ text, sourceUrl, fetchedAt, rawPayload: new Uint8Array(rawPdfBuffer) });
    if (!isSbpDailyRateCurrent(parsed)) {
      return validationError(`SBP source rate for ${parsed.rateDate} is stale and was not saved`);
    }
    const pdfKey = createFxEvidenceStorageKey("sbp", parsed.rateDate, "source.pdf");
    const screenshotKey = createFxEvidenceStorageKey("sbp", parsed.rateDate, "screenshot.png");
    await uploadFxCaptureEvidence({ key: pdfKey, buffer: rawPdfBuffer, contentType: "application/pdf", fileName: `sbp-usd-pkr-${parsed.rateDate}.pdf`, provider: "SBP" });
    uploadedKeys.push(pdfKey);
    await uploadFxCaptureEvidence({ key: screenshotKey, buffer: screenshotBuffer, contentType: "image/png", fileName: `sbp-usd-pkr-${parsed.rateDate}.png`, provider: "SBP" });
    uploadedKeys.push(screenshotKey);

    const result = await createSbpDailyFxSnapshot({
      ...parsed,
      fetchedAt,
      rawHtmlStorageKey: pdfKey,
      screenshotStorageKey: screenshotKey,
    });
    if (result.duplicate) {
      await Promise.all(uploadedKeys.map((key) => deleteBucketObject(key)));
      if (result.conflict) return errorResponse("SNAPSHOT_CONFLICT", "A different immutable SBP rate already exists for this date", 409);
    }
    return successResponse({ duplicate: result.duplicate, snapshot: result.snapshot }, result.duplicate ? "SBP daily rate already saved" : "SBP daily rate saved", result.duplicate ? 200 : 201);
  } catch (error) {
    await Promise.allSettled(uploadedKeys.map((key) => deleteBucketObject(key)));
    console.error("Create SBP daily FX snapshot error:", error);
    return serverError();
  }
}
