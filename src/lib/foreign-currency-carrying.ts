export const SUPPORTED_FOREIGN_CURRENCIES = ["USD", "AFN", "CNY", "AED"] as const;

/** Every currency code the application may persist. */
export const CANONICAL_CURRENCY_CODES = ["PKR", ...SUPPORTED_FOREIGN_CURRENCIES] as const;

export type CanonicalCurrencyCode = (typeof CANONICAL_CURRENCY_CODES)[number];

export class UnsupportedCurrencyCodeError extends Error {}

/**
 * Normalize and validate a currency code before it is persisted.
 *
 * `RMB` is an input alias for `CNY` and never persists as its own currency.
 * Anything outside the canonical set is rejected rather than coerced, so a
 * typo cannot silently become an unreconcilable ledger currency.
 *
 * A database-level constraint is deliberately not relied upon here: see
 * docs/foreign-currency-accounting-policy.md. Adding one requires first
 * confirming no production `currencies.code` or `accounts.currency_code` row
 * sits outside this set.
 */
export function assertCanonicalCurrencyCode(value: unknown): CanonicalCurrencyCode {
  const normalized = String(value ?? "").trim().toUpperCase();
  const canonical = normalized === "RMB" ? "CNY" : normalized;
  if (!(CANONICAL_CURRENCY_CODES as readonly string[]).includes(canonical)) {
    throw new UnsupportedCurrencyCodeError(
      `Unsupported currency code "${value}". Expected one of: ${CANONICAL_CURRENCY_CODES.join(", ")} (RMB is accepted as CNY).`
    );
  }
  return canonical as CanonicalCurrencyCode;
}

export type SupportedForeignCurrency = (typeof SUPPORTED_FOREIGN_CURRENCIES)[number];
export type ForeignCurrencyPositionKind = "asset" | "liability";

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function requirePositive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`);
  return value;
}

export function canonicalForeignCurrencyCode(code: string): string {
  const normalized = String(code || "").trim().toUpperCase();
  return normalized === "RMB" ? "CNY" : normalized;
}

export function isSupportedForeignCurrency(code: string): code is SupportedForeignCurrency {
  return SUPPORTED_FOREIGN_CURRENCIES.includes(canonicalForeignCurrencyCode(code) as SupportedForeignCurrency);
}

export type CarryingLayerGate = { ok: true } | { ok: false; message: string };

// Defence-in-depth gate, not the authoritative control.
//
// It answers "may this country/currency pair be journalized at all?" and must
// never be read as "capability is decided by country". Whether a specific
// non-PKR write path is actually wired to a carrying layer is asserted per
// route by src/lib/foreign-currency-route-coverage.test.ts, which requires
// every currency-accepting write route to either wire a carrying layer or
// reject non-PKR writes with FOREIGN_CARRYING_LAYER_REQUIRED.
// PKR is always journalizable. Everything else must be rejected rather than
// journalizing raw foreign units.
export function checkCarryingLayerWired(isAfghanistanCity: boolean, currencyCode: string): CarryingLayerGate {
  const code = canonicalForeignCurrencyCode(currencyCode);
  if (code === "PKR") return { ok: true };
  if (isAfghanistanCity && isSupportedForeignCurrency(code)) return { ok: true };
  return {
    ok: false,
    message: `Currency ${code} has no wired immutable PKR carrying layer for this country; non-PKR writes are rejected until the carrying layer records them atomically.`,
  };
}

export type AvailableForeignCurrencyLayer = {
  id: number;
  remainingForeignAmount: number;
  remainingCarryingAmountPkr: number;
  historicalPoolDate: string;
};

export type ForeignCurrencyLayerAllocation = {
  layerId: number;
  foreignAmount: number;
  carryingAmountPkr: number;
  historicalPoolDate: string;
};

export function allocateForeignCurrencyLayers(input: {
  amount: number;
  layers: AvailableForeignCurrencyLayer[];
}): ForeignCurrencyLayerAllocation[] {
  let remaining = requirePositive(input.amount, "Foreign amount");
  const allocations: ForeignCurrencyLayerAllocation[] = [];

  for (const layer of input.layers) {
    if (remaining <= 0) break;
    const available = Number(layer.remainingForeignAmount);
    const carrying = Number(layer.remainingCarryingAmountPkr);
    if (!(available > 0) || !(carrying >= 0)) continue;
    const foreignAmount = Math.min(remaining, available);
    const carryingAmountPkr = foreignAmount === available
      ? carrying
      : round2(carrying * (foreignAmount / available));
    allocations.push({
      layerId: layer.id,
      foreignAmount: round2(foreignAmount),
      carryingAmountPkr,
      historicalPoolDate: layer.historicalPoolDate,
    });
    remaining = round2(remaining - foreignAmount);
  }

  if (remaining > 0) throw new Error(`Insufficient foreign-currency carrying layers; ${remaining} remains unallocated.`);
  return allocations;
}

export function buildForeignCurrencyTransfer(input: {
  currencyCode: string;
  foreignAmount: number;
  carryingAmountPkr: number;
  historicalPoolDate: string;
}) {
  const currencyCode = canonicalForeignCurrencyCode(input.currencyCode);
  if (!isSupportedForeignCurrency(currencyCode)) throw new Error(`Unsupported foreign currency ${currencyCode || "UNKNOWN"}.`);
  requirePositive(input.foreignAmount, "Foreign amount");
  requirePositive(input.carryingAmountPkr, "PKR carrying amount");
  return {
    targetCurrencyCode: currencyCode,
    targetForeignAmount: round2(input.foreignAmount),
    targetCarryingAmountPkr: round2(input.carryingAmountPkr),
    realizedFxPkr: 0,
    historicalPoolDate: input.historicalPoolDate,
  };
}

export function buildForeignCurrencySettlement(input: {
  positionKind: ForeignCurrencyPositionKind;
  foreignAmount: number;
  carryingAmountPkr: number;
  settlementAmountPkr: number;
  historicalPoolDate: string;
}) {
  requirePositive(input.foreignAmount, "Foreign amount");
  requirePositive(input.carryingAmountPkr, "PKR carrying amount");
  requirePositive(input.settlementAmountPkr, "PKR settlement amount");
  const assetDifference = round2(input.settlementAmountPkr - input.carryingAmountPkr);
  return {
    foreignAmount: round2(input.foreignAmount),
    carryingAmountPkr: round2(input.carryingAmountPkr),
    settlementAmountPkr: round2(input.settlementAmountPkr),
    realizedFxPkr: input.positionKind === "asset" ? assetDifference : round2(-assetDifference),
    historicalPoolDate: input.historicalPoolDate,
  };
}

export function buildForeignCurrencyExchange(input: {
  sourceForeignAmount: number;
  sourceCarryingAmountPkr: number;
  targetCurrencyCode: string;
  targetAmount: number;
  historicalPoolDate: string;
}) {
  requirePositive(input.sourceForeignAmount, "Source foreign amount");
  requirePositive(input.sourceCarryingAmountPkr, "Source PKR carrying amount");
  requirePositive(input.targetAmount, "Target amount");
  const targetCurrencyCode = canonicalForeignCurrencyCode(input.targetCurrencyCode);
  if (targetCurrencyCode !== "PKR" && !isSupportedForeignCurrency(targetCurrencyCode)) {
    throw new Error(`Unsupported target currency ${targetCurrencyCode || "UNKNOWN"}.`);
  }
  const targetCarryingAmountPkr = targetCurrencyCode === "PKR"
    ? round2(input.targetAmount)
    : round2(input.sourceCarryingAmountPkr);
  return {
    targetCurrencyCode,
    targetAmount: round2(input.targetAmount),
    targetCarryingAmountPkr,
    targetRecognitionRatePkr: targetCurrencyCode === "PKR"
      ? 1
      : round2(targetCarryingAmountPkr / input.targetAmount),
    realizedFxPkr: targetCurrencyCode === "PKR"
      ? round2(targetCarryingAmountPkr - input.sourceCarryingAmountPkr)
      : 0,
    historicalPoolDate: input.historicalPoolDate,
  };
}
