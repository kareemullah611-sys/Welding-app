import { NextRequest } from "next/server";
import { withSuperAdmin } from "@/lib/middleware";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import {
  createSarafiAfFxSnapshot,
  listSarafiAfFxSnapshots,
  summarizeSarafiAfSnapshot,
} from "@/lib/sarafi-af-snapshot-db";
import {
  buildSarafiAfScheduledSnapshotDate,
  isSarafiAfAutoSnapshotEnabled,
  SARAFI_AF_MARKET,
  type SarafiAfQuoteInput,
} from "@/lib/sarafi-af-snapshot";

function parseQuotes(value: unknown): SarafiAfQuoteInput[] | null {
  if (!Array.isArray(value)) return null;
  const quotes = value.map((quote) => ({
    baseCurrencyCode: String((quote as any)?.baseCurrencyCode || "").trim().toUpperCase(),
    quoteCurrencyCode: String((quote as any)?.quoteCurrencyCode || "").trim().toUpperCase(),
    rawBuyRate: Number((quote as any)?.rawBuyRate),
    rawSellRate: Number((quote as any)?.rawSellRate),
    rawUnit: (quote as any)?.rawUnit ? String((quote as any).rawUnit) : "1",
  }));
  if (quotes.some((quote) => !quote.baseCurrencyCode || !quote.quoteCurrencyCode || !Number.isFinite(quote.rawBuyRate) || !Number.isFinite(quote.rawSellRate))) {
    return null;
  }
  return quotes;
}

export const GET = withSuperAdmin(async (request: NextRequest) => {
  try {
    const limit = Number(request.nextUrl.searchParams.get("limit") || 30);
    const snapshots = await listSarafiAfFxSnapshots(limit);
    return successResponse({
      snapshots,
      schedule: buildSarafiAfScheduledSnapshotDate(),
      autoSnapshotEnabled: isSarafiAfAutoSnapshotEnabled(),
      providerStatus: "Sarafi.af foundation is available, but automatic authoritative ingestion is disabled unless explicitly enabled.",
    });
  } catch (error) {
    console.error("List Sarafi.af FX snapshots error:", error);
    return serverError();
  }
});

export const POST = withSuperAdmin(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    const body = await request.json();
    if (body?.action === "fetch-live" && !isSarafiAfAutoSnapshotEnabled()) {
      return errorResponse(
        "FEATURE_DISABLED",
        "Sarafi.af automatic snapshot fetching is disabled. Add a manual audited snapshot or enable SARAFI_AF_AUTO_SNAPSHOT_ENABLED after provider approval.",
        403
      );
    }

    const scheduled = buildSarafiAfScheduledSnapshotDate();
    const requestedMarket = String(body?.market || SARAFI_AF_MARKET).trim().toLowerCase();
    if (requestedMarket !== SARAFI_AF_MARKET) {
      return validationError("Sarafi.af snapshots must be Sarai Shahzada market rates only");
    }
    const snapshotDate = String(body?.snapshotDate || scheduled.snapshotDate);
    const quotes = parseQuotes(body?.quotes);
    if (!quotes) return validationError("Valid USD/AFN, PKR/AFN, and CNY/AFN quotes are required");

    const result = await createSarafiAfFxSnapshot({
      snapshotDate,
      sourceTimestamp: body?.sourceTimestamp || null,
      rawReference: body?.rawReference || null,
      rawPayload: body?.rawPayload || body?.quotes,
      quotes,
      createdBy: user.userId,
    });

    if (!result.ok) {
      return validationError("Sarafi.af snapshot validation failed", [{ warnings: result.snapshot.validationWarnings }]);
    }

    return successResponse({
      id: result.id,
      duplicate: result.duplicate,
      snapshot: summarizeSarafiAfSnapshot(result.snapshot),
    }, result.duplicate ? "Snapshot already exists" : "Sarafi.af snapshot saved", result.duplicate ? 200 : 201);
  } catch (error) {
    console.error("Create Sarafi.af FX snapshot error:", error);
    return serverError();
  }
});
