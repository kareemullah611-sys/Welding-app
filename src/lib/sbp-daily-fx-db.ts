import prisma from "@/lib/prisma";
import { SBP_DAILY_MARKET, SBP_DAILY_RATE_SOURCE } from "@/lib/sbp-daily-fx";

const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);

function dto(row: any) {
  return {
    id: row.id,
    rateDate: row.rateDate.toISOString().slice(0, 10),
    provider: row.provider,
    market: row.market,
    sourceUrl: row.sourceUrl,
    fetchedAt: row.fetchedAt.toISOString(),
    buyRate: Number(row.buyRate),
    sellRate: Number(row.sellRate),
    referenceRate: Number(row.referenceRate),
    status: row.status,
    rawPayloadHash: row.rawPayloadHash,
    evidenceExpiresAt: row.evidenceExpiresAt.toISOString(),
    evidenceDeletedAt: row.evidenceDeletedAt?.toISOString() || null,
    evidenceAvailable: !row.evidenceDeletedAt && Boolean(row.rawHtmlStorageKey || row.screenshotStorageKey),
    exchangeRateId: row.exchangeRateId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSbpDailyFxSnapshots(limit = 30) {
  const rows = await (prisma as any).sbpDailyFxSnapshot.findMany({
    take: Math.min(Math.max(limit, 1), 100),
    orderBy: [{ rateDate: "desc" }, { id: "desc" }],
  });
  return rows.map(dto);
}

export async function createSbpDailyFxSnapshot(input: {
  rateDate: string;
  sourceUrl: string;
  fetchedAt: Date;
  buyRate: number;
  sellRate: number;
  referenceRate: number;
  rawPayloadHash: string;
  rawHtmlStorageKey: string;
  screenshotStorageKey: string;
}) {
  return prisma.$transaction(async (tx) => {
    const db = tx as any;
    const existingSnapshot = await db.sbpDailyFxSnapshot.findUnique({
      where: { rateDate_provider_market: { rateDate: dateOnly(input.rateDate), provider: "SBP", market: SBP_DAILY_MARKET } },
    });
    if (existingSnapshot) {
      const same = Number(existingSnapshot.buyRate) === input.buyRate
        && Number(existingSnapshot.sellRate) === input.sellRate
        && existingSnapshot.rawPayloadHash === input.rawPayloadHash;
      return { duplicate: true, conflict: !same, snapshot: dto(existingSnapshot) };
    }

    const [usd, pkr] = await Promise.all([
      db.currency.findUnique({ where: { code: "USD" }, select: { id: true } }),
      db.currency.findUnique({ where: { code: "PKR" }, select: { id: true } }),
    ]);
    if (!usd || !pkr) throw new Error("USD and PKR currency records are required");

    const existingRate = await db.exchangeRate.findUnique({
      where: {
        rateDate_fromCurrencyId_toCurrencyId_source: {
          rateDate: dateOnly(input.rateDate),
          fromCurrencyId: usd.id,
          toCurrencyId: pkr.id,
          source: SBP_DAILY_RATE_SOURCE,
        },
      },
    });
    if (existingRate) throw new Error("An immutable SBP daily rate already exists without its capture snapshot");

    const exchangeRate = await db.exchangeRate.create({
      data: {
        rateDate: dateOnly(input.rateDate),
        fromCurrencyId: usd.id,
        toCurrencyId: pkr.id,
        buyRate: input.buyRate,
        sellRate: input.sellRate,
        referenceRate: input.referenceRate,
        source: SBP_DAILY_RATE_SOURCE,
        entryMethod: "api",
        notes: `Official SBP weighted-average customer USD/PKR rate. Source: ${input.sourceUrl}. Evidence hash: ${input.rawPayloadHash}`,
      },
    });
    const evidenceExpiresAt = new Date(input.fetchedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const snapshot = await db.sbpDailyFxSnapshot.create({
      data: {
        rateDate: dateOnly(input.rateDate),
        provider: "SBP",
        market: SBP_DAILY_MARKET,
        sourceUrl: input.sourceUrl,
        fetchedAt: input.fetchedAt,
        buyRate: input.buyRate,
        sellRate: input.sellRate,
        referenceRate: input.referenceRate,
        status: "VALID_CURRENT",
        rawPayloadHash: input.rawPayloadHash,
        rawHtmlStorageKey: input.rawHtmlStorageKey,
        screenshotStorageKey: input.screenshotStorageKey,
        evidenceExpiresAt,
        exchangeRateId: exchangeRate.id,
      },
    });
    return { duplicate: false, conflict: false, snapshot: dto(snapshot) };
  });
}

export async function getSbpDailyFxEvidence(input: { id: number; type: "screenshot" | "html" }) {
  const row = await (prisma as any).sbpDailyFxSnapshot.findUnique({
    where: { id: input.id },
    select: { rateDate: true, evidenceDeletedAt: true, screenshotStorageKey: true, rawHtmlStorageKey: true },
  });
  if (!row || row.evidenceDeletedAt) return null;
  const date = row.rateDate.toISOString().slice(0, 10);
  const key = input.type === "screenshot" ? row.screenshotStorageKey : row.rawHtmlStorageKey;
  if (!key) return null;
  return input.type === "screenshot"
    ? { key, fileName: `sbp-usd-pkr-${date}.png`, contentType: "image/png" }
    : { key, fileName: `sbp-usd-pkr-${date}.html`, contentType: "text/html; charset=utf-8" };
}
