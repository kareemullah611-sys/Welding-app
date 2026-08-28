import { NextRequest } from "next/server";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { withSuperAdmin } from "@/lib/middleware";
import {
  isSarafiAfAssistedCaptureEnabled,
  isValidSarafiAfCaptureToken,
  parseSarafiAfSaraiShahzadaHtml,
  SARAFI_AF_ASSISTED_SOURCE_URL,
} from "@/lib/sarafi-af-assisted-capture";
import { createSarafiAfCaptureDraft, listSarafiAfCaptureDrafts } from "@/lib/sarafi-af-assisted-capture-db";
import { createSarafiCaptureStorageKey, uploadSarafiCaptureEvidence } from "@/lib/railway-bucket";

export const runtime = "nodejs";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024;

export const GET = withSuperAdmin(async (request: NextRequest) => {
  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") || 30);
    return successResponse({
      captures: await listSarafiAfCaptureDrafts(limit),
      assistedCaptureEnabled: isSarafiAfAssistedCaptureEnabled(),
    });
  } catch (error) {
    console.error("List Sarafi.af assisted captures error:", error);
    return serverError();
  }
});

export async function POST(request: NextRequest) {
  try {
    if (!isSarafiAfAssistedCaptureEnabled()) {
      return errorResponse("FEATURE_DISABLED", "Sarafi.af assisted capture is disabled", 403);
    }
    if (!isValidSarafiAfCaptureToken(request.headers.get("x-sarafi-capture-token"))) {
      return errorResponse("UNAUTHORIZED", "Invalid capture token", 401);
    }

    const formData = await request.formData();
    const rawHtmlFile = formData.get("rawHtml");
    const screenshotFile = formData.get("screenshot");
    if (!(rawHtmlFile instanceof File) || !(screenshotFile instanceof File)) {
      return validationError("Raw HTML and screenshot evidence are required");
    }
    if (rawHtmlFile.size <= 0 || rawHtmlFile.size > MAX_HTML_BYTES) return validationError("Raw HTML evidence has an invalid size");
    if (screenshotFile.size <= 0 || screenshotFile.size > MAX_SCREENSHOT_BYTES) return validationError("Screenshot evidence has an invalid size");
    if (!String(screenshotFile.type || "").startsWith("image/png")) return validationError("Screenshot evidence must be PNG");

    const fetchedAt = new Date(String(formData.get("fetchedAt") || ""));
    if (!Number.isFinite(fetchedAt.getTime()) || Math.abs(Date.now() - fetchedAt.getTime()) > 12 * 60 * 60 * 1000) {
      return validationError("Capture timestamp is missing or outside the allowed review window");
    }
    const sourceUrl = String(formData.get("sourceUrl") || SARAFI_AF_ASSISTED_SOURCE_URL);
    const rawHtmlBuffer = Buffer.from(await rawHtmlFile.arrayBuffer());
    const screenshotBuffer = Buffer.from(await screenshotFile.arrayBuffer());
    const capture = parseSarafiAfSaraiShahzadaHtml({
      html: rawHtmlBuffer.toString("utf8"),
      sourceUrl,
      fetchedAt,
    });

    const rawHtmlKey = createSarafiCaptureStorageKey(capture.snapshotDate, "source.html");
    const screenshotKey = createSarafiCaptureStorageKey(capture.snapshotDate, "screenshot.png");
    await uploadSarafiCaptureEvidence({
      key: rawHtmlKey,
      buffer: rawHtmlBuffer,
      contentType: "text/html; charset=utf-8",
      fileName: `sarafi-af-${capture.snapshotDate}.html`,
    });
    await uploadSarafiCaptureEvidence({
      key: screenshotKey,
      buffer: screenshotBuffer,
      contentType: "image/png",
      fileName: `sarafi-af-${capture.snapshotDate}.png`,
    });

    const result = await createSarafiAfCaptureDraft({
      capture,
      rawHtmlStorageKey: rawHtmlKey,
      screenshotStorageKey: screenshotKey,
    });
    return successResponse(
      { duplicate: result.duplicate, capture: result.draft },
      result.duplicate ? "Capture draft already exists" : "Capture draft saved for superadmin review",
      result.duplicate ? 200 : 201,
    );
  } catch (error) {
    console.error("Create Sarafi.af assisted capture error:", error);
    return serverError();
  }
}
