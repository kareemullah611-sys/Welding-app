import { NextRequest } from "next/server";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { withSuperAdmin } from "@/lib/middleware";
import { createSbpDailyFxSnapshot, listSbpDailyFxSnapshots } from "@/lib/sbp-daily-fx-db";
import { isSbpDailyRateCurrent, isValidDailyFxCaptureToken, parseSbpUsdPkrDailyHtml, SBP_DAILY_SOURCE_URL } from "@/lib/sbp-daily-fx";
import { createFxEvidenceStorageKey, deleteBucketObject, uploadFxCaptureEvidence } from "@/lib/railway-bucket";

export const runtime = "nodejs";
const MAX_HTML_BYTES = 2 * 1024 * 1024;
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
    const rawHtmlFile = formData.get("rawHtml");
    const screenshotFile = formData.get("screenshot");
    if (!(rawHtmlFile instanceof File) || !(screenshotFile instanceof File)) return validationError("Raw HTML and screenshot evidence are required");
    if (rawHtmlFile.size <= 0 || rawHtmlFile.size > MAX_HTML_BYTES) return validationError("Raw HTML evidence has an invalid size");
    if (screenshotFile.size <= 0 || screenshotFile.size > MAX_SCREENSHOT_BYTES || !String(screenshotFile.type).startsWith("image/png")) {
      return validationError("Screenshot evidence must be a valid PNG");
    }
    const fetchedAt = new Date(String(formData.get("fetchedAt") || ""));
    if (!Number.isFinite(fetchedAt.getTime()) || Math.abs(Date.now() - fetchedAt.getTime()) > 12 * 60 * 60 * 1000) {
      return validationError("Capture timestamp is missing or outside the allowed window");
    }
    const sourceUrl = String(formData.get("sourceUrl") || SBP_DAILY_SOURCE_URL);
    const rawHtmlBuffer = Buffer.from(await rawHtmlFile.arrayBuffer());
    const screenshotBuffer = Buffer.from(await screenshotFile.arrayBuffer());
    const parsed = parseSbpUsdPkrDailyHtml({ html: rawHtmlBuffer.toString("utf8"), sourceUrl, fetchedAt });
    if (!isSbpDailyRateCurrent(parsed)) {
      return validationError(`SBP source rate for ${parsed.rateDate} is stale and was not saved`);
    }
    const htmlKey = createFxEvidenceStorageKey("sbp", parsed.rateDate, "source.html");
    const screenshotKey = createFxEvidenceStorageKey("sbp", parsed.rateDate, "screenshot.png");
    await uploadFxCaptureEvidence({ key: htmlKey, buffer: rawHtmlBuffer, contentType: "text/html; charset=utf-8", fileName: `sbp-usd-pkr-${parsed.rateDate}.html`, provider: "SBP" });
    uploadedKeys.push(htmlKey);
    await uploadFxCaptureEvidence({ key: screenshotKey, buffer: screenshotBuffer, contentType: "image/png", fileName: `sbp-usd-pkr-${parsed.rateDate}.png`, provider: "SBP" });
    uploadedKeys.push(screenshotKey);

    const result = await createSbpDailyFxSnapshot({
      ...parsed,
      fetchedAt,
      rawHtmlStorageKey: htmlKey,
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
