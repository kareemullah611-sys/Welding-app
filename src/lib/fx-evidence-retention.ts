import prisma from "@/lib/prisma";
import { deleteBucketObject } from "@/lib/railway-bucket";

async function deleteEvidenceKeys(keys: Array<string | null | undefined>) {
  for (const key of keys.filter((value): value is string => Boolean(value))) {
    await deleteBucketObject(key);
  }
}

export async function purgeExpiredFxEvidence(now = new Date()) {
  const [sarafiRows, sbpRows] = await Promise.all([
    (prisma as any).sarafiAfAssistedCaptureDraft.findMany({
      where: { evidenceExpiresAt: { lte: now }, evidenceDeletedAt: null },
      select: { id: true, rawHtmlStorageKey: true, screenshotStorageKey: true },
    }),
    (prisma as any).sbpDailyFxSnapshot.findMany({
      where: { evidenceExpiresAt: { lte: now }, evidenceDeletedAt: null },
      select: { id: true, rawHtmlStorageKey: true, screenshotStorageKey: true },
    }),
  ]);

  let sarafiDeleted = 0;
  let sbpDeleted = 0;
  for (const row of sarafiRows) {
    await deleteEvidenceKeys([row.rawHtmlStorageKey, row.screenshotStorageKey]);
    await (prisma as any).sarafiAfAssistedCaptureDraft.update({
      where: { id: row.id },
      data: { rawHtmlStorageKey: null, screenshotStorageKey: null, evidenceDeletedAt: now },
    });
    sarafiDeleted += 1;
  }
  for (const row of sbpRows) {
    await deleteEvidenceKeys([row.rawHtmlStorageKey, row.screenshotStorageKey]);
    await (prisma as any).sbpDailyFxSnapshot.update({
      where: { id: row.id },
      data: { rawHtmlStorageKey: null, screenshotStorageKey: null, evidenceDeletedAt: now },
    });
    sbpDeleted += 1;
  }

  return { sarafiDeleted, sbpDeleted, totalDeleted: sarafiDeleted + sbpDeleted };
}
