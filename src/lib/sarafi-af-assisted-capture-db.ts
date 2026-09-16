import prisma from "@/lib/prisma";
import { createSarafiAfFxSnapshot } from "@/lib/sarafi-af-snapshot-db";
import { normalizeSarafiAfSnapshot, SARAFI_AF_MARKET, SARAFI_AF_SCHEDULED_TIME, SARAFI_AF_TIMEZONE } from "@/lib/sarafi-af-snapshot";
import type { ParsedSarafiAfAssistedCapture } from "@/lib/sarafi-af-assisted-capture";

function dateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function draftDto(row: any) {
  return {
    id: row.id,
    snapshotDate: row.snapshotDate.toISOString().split("T")[0],
    scheduledTime: row.scheduledTime,
    timezone: row.timezone,
    provider: row.provider,
    market: row.market,
    sourceUrl: row.sourceUrl,
    fetchedAt: row.fetchedAt.toISOString(),
    sourceTimestamp: row.sourceTimestamp.toISOString(),
    status: row.status,
    rawPayloadHash: row.rawPayloadHash,
    quotes: row.quotesJson || [],
    validationWarnings: row.validationWarningsJson || [],
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt?.toISOString() || null,
    reviewNotes: row.reviewNotes,
    approvedSnapshotId: row.approvedSnapshotId,
    evidenceExpiresAt: row.evidenceExpiresAt.toISOString(),
    evidenceDeletedAt: row.evidenceDeletedAt?.toISOString() || null,
    evidenceAvailable: !row.evidenceDeletedAt && Boolean(row.rawHtmlStorageKey || row.screenshotStorageKey),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSarafiAfCaptureDrafts(limit = 30) {
  const rows = await (prisma as any).sarafiAfAssistedCaptureDraft.findMany({
    take: Math.min(Math.max(limit, 1), 100),
    orderBy: [{ snapshotDate: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(draftDto);
}

export async function createSarafiAfCaptureDraft(input: {
  capture: ParsedSarafiAfAssistedCapture;
  rawHtmlStorageKey: string;
  screenshotStorageKey: string;
}) {
  const preview = normalizeSarafiAfSnapshot({
    snapshotDate: input.capture.snapshotDate,
    fetchedAt: new Date(input.capture.fetchedAt),
    sourceTimestamp: input.capture.sourceTimestamp,
    rawReference: input.capture.sourceUrl,
    rawPayload: { rawPayloadHash: input.capture.rawPayloadHash, quotes: input.capture.quotes },
    providerMode: "HTML_FETCH",
    quotes: input.capture.quotes,
  });
  const warnings = [...preview.validationWarnings];
  if (preview.status === "STALE_SOURCE_RATE") warnings.push("Captured source rates are stale and cannot be approved.");
  const idempotencyKey = `sarafi-af-assisted:${input.capture.snapshotDate}:${input.capture.rawPayloadHash}`;
  const existing = await (prisma as any).sarafiAfAssistedCaptureDraft.findUnique({
    where: { idempotencyKey },
  });
  if (existing) return { duplicate: true, draft: draftDto(existing) };

  const saved = await (prisma as any).sarafiAfAssistedCaptureDraft.create({
    data: {
      snapshotDate: dateOnly(input.capture.snapshotDate),
      scheduledTime: SARAFI_AF_SCHEDULED_TIME,
      timezone: SARAFI_AF_TIMEZONE,
      provider: "SARAFI_AF",
      market: SARAFI_AF_MARKET,
      sourceUrl: input.capture.sourceUrl,
      fetchedAt: new Date(input.capture.fetchedAt),
      sourceTimestamp: new Date(input.capture.sourceTimestamp),
      status: "PENDING_REVIEW",
      rawPayloadHash: input.capture.rawPayloadHash,
      rawHtmlStorageKey: input.rawHtmlStorageKey,
      screenshotStorageKey: input.screenshotStorageKey,
      evidenceExpiresAt: new Date(new Date(input.capture.fetchedAt).getTime() + 7 * 24 * 60 * 60 * 1000),
      quotesJson: input.capture.quotes,
      validationWarningsJson: warnings,
      idempotencyKey,
    },
  });
  return { duplicate: false, draft: draftDto(saved) };
}

export async function reviewSarafiAfCaptureDraft(input: {
  id: number;
  action: "approve" | "reject";
  reviewedBy: number | null;
  reviewNotes?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "sarafi_af_assisted_capture_drafts" WHERE "id" = ${input.id} FOR UPDATE`;
    const draft = await (tx as any).sarafiAfAssistedCaptureDraft.findUnique({ where: { id: input.id } });
    if (!draft) return { ok: false as const, code: "NOT_FOUND", message: "Capture draft not found" };
    if (draft.status !== "PENDING_REVIEW") {
      return { ok: false as const, code: "INVALID_STATUS", message: `Capture draft is already ${draft.status.toLowerCase()}` };
    }

    if (input.action === "reject") {
      const rejected = await (tx as any).sarafiAfAssistedCaptureDraft.update({
        where: { id: input.id },
        data: {
          status: "REJECTED",
          reviewedBy: input.reviewedBy,
          reviewedAt: new Date(),
          reviewNotes: input.reviewNotes || null,
        },
      });
      return { ok: true as const, draft: draftDto(rejected), snapshotId: null };
    }

    const quotes = Array.isArray(draft.quotesJson) ? draft.quotesJson : [];
    const approvalPreview = normalizeSarafiAfSnapshot({
      snapshotDate: draft.snapshotDate.toISOString().split("T")[0],
      fetchedAt: draft.fetchedAt,
      sourceTimestamp: draft.fetchedAt,
      rawReference: draft.sourceUrl,
      rawPayload: { captureDraftId: draft.id, rawPayloadHash: draft.rawPayloadHash, quotes },
      providerMode: "HTML_FETCH",
      quotes,
    });
    if (approvalPreview.status !== "VALID_CURRENT") {
      const warnings = [...approvalPreview.validationWarnings];
      if (approvalPreview.status === "STALE_SOURCE_RATE") warnings.push("Captured source rates are stale and cannot be approved.");
      return {
        ok: false as const,
        code: "VALIDATION_FAILED",
        message: `Capture cannot be approved: ${warnings.join(" ") || approvalPreview.status}`,
        warnings,
      };
    }
    const result = await createSarafiAfFxSnapshot({
      snapshotDate: draft.snapshotDate.toISOString().split("T")[0],
      fetchedAt: draft.fetchedAt,
      sourceTimestamp: draft.fetchedAt,
      rawReference: draft.sourceUrl,
      rawPayload: { captureDraftId: draft.id, rawPayloadHash: draft.rawPayloadHash, quotes },
      rawPayloadHash: draft.rawPayloadHash,
      providerMode: "HTML_FETCH",
      quotes,
      createdBy: input.reviewedBy,
      tx,
    });
    if (!result.ok || result.snapshot.status !== "VALID_CURRENT") {
      return {
        ok: false as const,
        code: "VALIDATION_FAILED",
        message: `Capture cannot be approved: ${result.snapshot.validationWarnings.join(" ") || result.snapshot.status}`,
        warnings: result.snapshot.validationWarnings,
      };
    }
    if (
      result.duplicate
      && (result.existingProviderMode !== "HTML_FETCH" || result.existingRawPayloadHash !== draft.rawPayloadHash)
    ) {
      return {
        ok: false as const,
        code: "EXISTING_SNAPSHOT_CONFLICT",
        message: "A different snapshot already exists for this date; review it instead of replacing it",
      };
    }

    const approved = await (tx as any).sarafiAfAssistedCaptureDraft.update({
      where: { id: input.id },
      data: {
        status: "APPROVED",
        reviewedBy: input.reviewedBy,
        reviewedAt: new Date(),
        reviewNotes: input.reviewNotes || null,
        approvedSnapshotId: result.id,
      },
    });
    return { ok: true as const, draft: draftDto(approved), snapshotId: result.id };
  });
}

export async function authorizeSarafiAfCaptureDraft(input: {
  id: number;
  reviewNotes: string;
}) {
  return reviewSarafiAfCaptureDraft({
    id: input.id,
    action: "approve",
    reviewedBy: null,
    reviewNotes: input.reviewNotes,
  });
}

export async function getSarafiAfCaptureEvidence(input: { id: number; type: "screenshot" | "html" }) {
  const draft = await (prisma as any).sarafiAfAssistedCaptureDraft.findUnique({
    where: { id: input.id },
    select: { snapshotDate: true, evidenceDeletedAt: true, screenshotStorageKey: true, rawHtmlStorageKey: true },
  });
  if (!draft || draft.evidenceDeletedAt) return null;
  const date = draft.snapshotDate.toISOString().split("T")[0];
  const key = input.type === "screenshot" ? draft.screenshotStorageKey : draft.rawHtmlStorageKey;
  if (!key) return null;
  return input.type === "screenshot"
    ? { key, fileName: `sarafi-af-${date}.png`, contentType: "image/png" }
    : { key, fileName: `sarafi-af-${date}.html`, contentType: "text/html; charset=utf-8" };
}
