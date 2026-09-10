import prisma from "@/lib/prisma";
import { resolveAfghanistanFxRateFromDb } from "@/lib/sarafi-af-snapshot-db";
import { resolvePakistanUsdLotRecognitionRate } from "@/lib/lot-recognition-fx";

function dateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

export async function resolveLotRecognitionRateFromDb(input: {
  tx?: any;
  countryCode: string;
  transactionDate: Date;
}) {
  const db = input.tx || prisma;
  const countryCode = String(input.countryCode || "").trim().toUpperCase();
  const transactionDate = dateOnly(input.transactionDate);

  if (countryCode === "PK") {
    const [country, usd, pkr] = await Promise.all([
      db.country.findUnique({ where: { code: countryCode }, select: { id: true } }),
      db.currency.findUnique({ where: { code: "USD" }, select: { id: true } }),
      db.currency.findUnique({ where: { code: "PKR" }, select: { id: true } }),
    ]);
    if (!country || !usd || !pkr) return { ok: false as const, missingReason: "Pakistan, USD, and PKR records are required." };
    const [rows, fallbackRows] = await Promise.all([
      db.exchangeRate.findMany({
        where: {
          fromCurrencyId: usd.id,
          toCurrencyId: pkr.id,
          rateDate: { lte: input.transactionDate },
          source: { in: ["SBP_OPEN_MARKET_CLOSING", "sbp_open_market_closing"] },
          sellRate: { not: null },
        },
        orderBy: [{ rateDate: "desc" }, { id: "desc" }],
        take: 30,
      }),
      db.countryFallbackExchangeRate.findMany({
        where: {
          countryId: country.id,
          fromCurrencyId: usd.id,
          toCurrencyId: pkr.id,
          effectiveFrom: { lte: input.transactionDate },
          isActive: true,
        },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
        take: 30,
      }),
    ]);
    return resolvePakistanUsdLotRecognitionRate({
      transactionDate,
      rates: rows.map((row: any) => ({
        rateDate: dateOnly(row.rateDate),
        buyRate: Number(row.buyRate || 0),
        sellRate: Number(row.sellRate || 0),
        providerReference: `exchange_rates:${row.id}`,
      })),
      fallbackRates: fallbackRows.map((row: any) => ({
        effectiveFrom: dateOnly(row.effectiveFrom),
        rate: Number(row.rate),
        providerReference: `country_fallback_exchange_rates:${row.id}`,
      })),
    });
  }

  if (countryCode === "AF") {
    return resolveAfghanistanFxRateFromDb({
      tx: db,
      currencyCode: "USD",
      transactionDate: input.transactionDate,
      purpose: "lot_initial_recognition",
      positionKind: "liability",
    });
  }

  return { ok: false as const, missingReason: `Unsupported lot recognition country ${countryCode || "unknown"}.` };
}
