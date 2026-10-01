import prisma from "@/lib/prisma";
import { canonicalForeignCurrencyCode } from "@/lib/foreign-currency-carrying";

/**
 * Authoritative evidence required for a non-PKR opening balance.
 *
 * An opening carrying amount becomes the immutable basis every later settlement
 * compares against, so the rate must be traceable to stored evidence. A free
 * text provider is never sufficient.
 */
export const OPENING_FX_EVIDENCE_PROVIDERS = [
  "SBP_DAILY_FX",
  "SARAFI_AF_SNAPSHOT",
  "COUNTRY_FALLBACK",
  "MANUAL_HISTORICAL_REMEDIATION",
] as const;

export type OpeningFxEvidenceProvider = (typeof OPENING_FX_EVIDENCE_PROVIDERS)[number];

/** Providers whose rate must be reproducible from a stored snapshot row. */
const SNAPSHOT_BACKED: readonly OpeningFxEvidenceProvider[] = [
  "SBP_DAILY_FX",
  "SARAFI_AF_SNAPSHOT",
  "COUNTRY_FALLBACK",
];

/** Rate must match stored evidence within this PKR tolerance. */
const SNAPSHOT_RATE_TOLERANCE_PKR = 0.01;

/** The literal confirmation a manual historical rate must carry. */
export const MANUAL_HISTORICAL_APPROVAL_PHRASE = "APPROVE MANUAL HISTORICAL RATE";

export class OpeningFxEvidenceError extends Error {}

export type OpeningFxEvidenceInput = {
  currencyCode: string;
  rate: number;
  rateDate: Date;
  provider: string;
  reference: string | null | undefined;
  approval?: string | null;
  db?: Pick<typeof prisma, "sbpDailyFxSnapshot" | "sarafiAfFxDerivedRate" | "countryFallbackExchangeRate">;
};

function parseProvider(raw: string): OpeningFxEvidenceProvider {
  const normalized = String(raw || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  const match = OPENING_FX_EVIDENCE_PROVIDERS.find((p) => p === normalized);
  if (!match) {
    throw new OpeningFxEvidenceError(
      `Unsupported opening FX evidence provider "${raw}". Use one of: ${OPENING_FX_EVIDENCE_PROVIDERS.join(", ")}.`
    );
  }
  return match;
}

async function resolveSnapshotRate(
  db: NonNullable<OpeningFxEvidenceInput["db"]>,
  provider: OpeningFxEvidenceProvider,
  currencyCode: string,
  rateDate: Date
): Promise<number | null> {
  const day = new Date(Date.UTC(rateDate.getUTCFullYear(), rateDate.getUTCMonth(), rateDate.getUTCDate()));

  if (provider === "SBP_DAILY_FX") {
    // SBP publishes PKR per USD only.
    if (currencyCode !== "USD") return null;
    const row = await db.sbpDailyFxSnapshot.findFirst({
      where: { rateDate: day },
      orderBy: { id: "desc" },
      select: { sellRate: true },
    });
    return row ? Number(row.sellRate) : null;
  }

  if (provider === "SARAFI_AF_SNAPSHOT") {
    const row = await db.sarafiAfFxDerivedRate.findFirst({
      where: {
        snapshot: { snapshotDate: day },
        fromCurrency: { code: currencyCode },
        toCurrency: { code: "PKR" },
      },
      orderBy: { id: "desc" },
      select: { sellRate: true },
    });
    return row ? Number(row.sellRate) : null;
  }

  const row = await db.countryFallbackExchangeRate.findFirst({
    where: {
      fromCurrency: { code: currencyCode },
      toCurrency: { code: "PKR" },
      isActive: true,
      effectiveFrom: { lte: day },
    },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
    select: { rate: true },
  });
  return row ? Number(row.rate) : null;
}

/**
 * Validate opening FX evidence without ever substituting or deriving a rate.
 *
 * Returns the normalized provider so the caller records the authoritative value
 * rather than the client's raw string.
 */
export async function assertOpeningFxEvidence(input: OpeningFxEvidenceInput): Promise<OpeningFxEvidenceProvider> {
  const code = canonicalForeignCurrencyCode(input.currencyCode);
  if (code === "PKR") return "SBP_DAILY_FX";

  if (!Number.isFinite(input.rate) || input.rate <= 0) {
    throw new OpeningFxEvidenceError(`Opening ${code} rate must be greater than zero.`);
  }
  if (!(input.rateDate instanceof Date) || Number.isNaN(input.rateDate.getTime())) {
    throw new OpeningFxEvidenceError(`Opening ${code} rate date is required.`);
  }

  const provider = parseProvider(input.provider);

  if (provider === "MANUAL_HISTORICAL_REMEDIATION") {
    // Documented manual rates stay available, but only through an explicit,
    // self-describing approval path that leaves an audit trail.
    if (String(input.approval || "").trim() !== MANUAL_HISTORICAL_APPROVAL_PHRASE) {
      throw new OpeningFxEvidenceError(
        `A manual historical ${code} opening rate requires approval confirmation "${MANUAL_HISTORICAL_APPROVAL_PHRASE}".`
      );
    }
    if (!String(input.reference || "").trim()) {
      throw new OpeningFxEvidenceError(
        `A manual historical ${code} opening rate requires a documented evidence reference.`
      );
    }
    return provider;
  }

  const db = input.db ?? prisma;
  const snapshotRate = await resolveSnapshotRate(db, provider, code, input.rateDate);
  if (snapshotRate === null) {
    throw new OpeningFxEvidenceError(
      `No stored ${provider} snapshot for ${code}/PKR on ${input.rateDate.toISOString().slice(0, 10)}. ` +
        `Record the snapshot or use MANUAL_HISTORICAL_REMEDIATION with documented evidence.`
    );
  }
  if (Math.abs(snapshotRate - input.rate) > SNAPSHOT_RATE_TOLERANCE_PKR) {
    throw new OpeningFxEvidenceError(
      `Opening ${code} rate ${input.rate} does not match the stored ${provider} snapshot (${snapshotRate}).`
    );
  }
  return provider;
}
