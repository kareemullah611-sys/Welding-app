export type LiabilitySettlementAllocation = {
  liabilityAmountUsd: number;
  previouslySettledUsd: number;
  settlementAmountUsd: number;
  carryingRatePkr: number;
  carryingAmountPkr: number;
  actualSettlementPkr: number;
  actualSettlementRatePkr: number;
  realizedFxPkr: number;
  remainingLiabilityUsd: number;
};

export type LiabilityCarryingLayer = {
  amountUsd: number;
  carryingRatePkr: number;
  recognitionDate: string;
};

export class LiabilityFxValidationError extends Error {}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function round6(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}

function requirePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new LiabilityFxValidationError(`${label} must be greater than zero.`);
  return value;
}

export function allocateLiabilitySettlement(input: {
  liabilityAmountUsd: number;
  carryingRatePkr: number;
  previouslySettledUsd: number;
  settlementAmountUsd: number;
  actualSettlementPkr: number;
}): LiabilitySettlementAllocation {
  const liabilityAmountUsd = requirePositive(input.liabilityAmountUsd, "Liability amount");
  const carryingRatePkr = requirePositive(input.carryingRatePkr, "Carrying rate");
  const settlementAmountUsd = requirePositive(input.settlementAmountUsd, "Settlement amount");
  const actualSettlementPkr = requirePositive(input.actualSettlementPkr, "Actual settlement PKR amount");
  const previouslySettledUsd = Number(input.previouslySettledUsd || 0);
  if (!Number.isFinite(previouslySettledUsd) || previouslySettledUsd < 0) {
    throw new LiabilityFxValidationError("Previously settled amount cannot be negative.");
  }
  const remainingBeforeSettlement = round2(liabilityAmountUsd - previouslySettledUsd);
  if (settlementAmountUsd > remainingBeforeSettlement + 0.001) {
    throw new LiabilityFxValidationError(`Settlement exceeds remaining liability of USD ${remainingBeforeSettlement}.`);
  }

  const carryingAmountPkr = round2(settlementAmountUsd * carryingRatePkr);
  return {
    liabilityAmountUsd: round2(liabilityAmountUsd),
    previouslySettledUsd: round2(previouslySettledUsd),
    settlementAmountUsd: round2(settlementAmountUsd),
    carryingRatePkr: round6(carryingRatePkr),
    carryingAmountPkr,
    actualSettlementPkr: round2(actualSettlementPkr),
    actualSettlementRatePkr: round6(actualSettlementPkr / settlementAmountUsd),
    realizedFxPkr: round2(carryingAmountPkr - actualSettlementPkr),
    remainingLiabilityUsd: round2(remainingBeforeSettlement - settlementAmountUsd),
  };
}

export function allocateLiabilitySettlementLayers(input: {
  layers: LiabilityCarryingLayer[];
  previouslySettledUsd: number;
  settlementAmountUsd: number;
  actualSettlementPkr: number;
}) {
  if (input.layers.length === 0) throw new LiabilityFxValidationError("No documented liability carrying layers are available.");
  const normalizedLayers = input.layers.map((layer) => ({
    amountUsd: requirePositive(Number(layer.amountUsd), "Liability layer amount"),
    carryingRatePkr: requirePositive(Number(layer.carryingRatePkr), "Liability layer carrying rate"),
    recognitionDate: String(layer.recognitionDate || ""),
  }));
  const liabilityAmountUsd = round2(normalizedLayers.reduce((sum, layer) => sum + layer.amountUsd, 0));
  const previouslySettledUsd = Number(input.previouslySettledUsd || 0);
  const settlementAmountUsd = requirePositive(input.settlementAmountUsd, "Settlement amount");
  const actualSettlementPkr = requirePositive(input.actualSettlementPkr, "Actual settlement PKR amount");
  if (!Number.isFinite(previouslySettledUsd) || previouslySettledUsd < 0) {
    throw new LiabilityFxValidationError("Previously settled amount cannot be negative.");
  }
  if (previouslySettledUsd + settlementAmountUsd > liabilityAmountUsd + 0.001) {
    throw new LiabilityFxValidationError(`Settlement exceeds remaining liability of USD ${round2(liabilityAmountUsd - previouslySettledUsd)}.`);
  }

  let skipUsd = previouslySettledUsd;
  let requiredUsd = settlementAmountUsd;
  const consumedLayers: LiabilityCarryingLayer[] = [];
  for (const layer of normalizedLayers) {
    const availableAfterPrior = Math.max(0, layer.amountUsd - Math.min(layer.amountUsd, skipUsd));
    skipUsd = Math.max(0, skipUsd - layer.amountUsd);
    if (availableAfterPrior <= 0 || requiredUsd <= 0) continue;
    const consumedUsd = Math.min(availableAfterPrior, requiredUsd);
    consumedLayers.push({
      amountUsd: round2(consumedUsd),
      carryingRatePkr: round6(layer.carryingRatePkr),
      recognitionDate: layer.recognitionDate,
    });
    requiredUsd = round2(requiredUsd - consumedUsd);
  }
  if (requiredUsd > 0.001) throw new LiabilityFxValidationError("Documented carrying layers do not cover the settlement amount.");

  const carryingAmountPkr = round2(consumedLayers.reduce(
    (sum, layer) => sum + (layer.amountUsd * layer.carryingRatePkr),
    0,
  ));
  const carryingRatePkr = round6(carryingAmountPkr / settlementAmountUsd);
  return {
    ...allocateLiabilitySettlement({
      liabilityAmountUsd,
      carryingRatePkr,
      previouslySettledUsd,
      settlementAmountUsd,
      actualSettlementPkr,
    }),
    carryingAmountPkr,
    realizedFxPkr: round2(carryingAmountPkr - actualSettlementPkr),
    originalPoolDate: consumedLayers[0].recognitionDate,
    consumedLayers,
  };
}

export function buildRealizedFxPostingAmounts(input: {
  carryingAmountPkr: number;
  actualSettlementPkr: number;
}) {
  const liabilityDebitPkr = round2(requirePositive(input.carryingAmountPkr, "Carrying amount"));
  const sourceCreditPkr = round2(requirePositive(input.actualSettlementPkr, "Actual settlement amount"));
  const realizedFxPkr = round2(liabilityDebitPkr - sourceCreditPkr);
  return {
    liabilityDebitPkr,
    sourceCreditPkr,
    fxGainCreditPkr: realizedFxPkr > 0 ? realizedFxPkr : 0,
    fxLossDebitPkr: realizedFxPkr < 0 ? Math.abs(realizedFxPkr) : 0,
  };
}

export function settlementJournalTransactionId(
  prefix: "SUPPPAY" | "SLPAY",
  paymentId: number,
  version: number,
): string {
  if (!Number.isInteger(version) || version < 1) throw new LiabilityFxValidationError("Journal version must be a positive integer.");
  return version === 1 ? `${prefix}-${paymentId}` : `${prefix}-${paymentId}-V${version}`;
}
