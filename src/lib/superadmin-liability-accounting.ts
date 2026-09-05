const round2 = (value: number) => Math.round(value * 100) / 100;

export class SuperAdminLiabilitySettlementError extends Error {}

export function calculateLiabilitySettlementFx(input: {
  outstandingForeignAmount: number;
  outstandingCarryingPkr: number;
  settlementForeignAmount: number;
  settlementRateToPkr: number;
}) {
  const outstandingForeignAmount = round2(input.outstandingForeignAmount);
  const outstandingCarryingPkr = round2(input.outstandingCarryingPkr);
  const settlementForeignAmount = round2(input.settlementForeignAmount);
  const settlementRateToPkr = input.settlementRateToPkr;

  if (!Number.isFinite(outstandingForeignAmount) || outstandingForeignAmount <= 0) {
    throw new SuperAdminLiabilitySettlementError("No outstanding liability remains in this currency");
  }
  if (!Number.isFinite(outstandingCarryingPkr) || outstandingCarryingPkr <= 0) {
    throw new SuperAdminLiabilitySettlementError("Outstanding liability has no valid PKR carrying value");
  }
  if (!Number.isFinite(settlementForeignAmount) || settlementForeignAmount <= 0) {
    throw new SuperAdminLiabilitySettlementError("Settlement amount must be greater than zero");
  }
  if (settlementForeignAmount - outstandingForeignAmount > 0.005) {
    throw new SuperAdminLiabilitySettlementError("Settlement amount exceeds outstanding liability");
  }
  if (!Number.isFinite(settlementRateToPkr) || settlementRateToPkr <= 0) {
    throw new SuperAdminLiabilitySettlementError("Settlement exchange rate must be greater than zero");
  }

  const carryingRatePkr = outstandingCarryingPkr / outstandingForeignAmount;
  const carryingAmountPkr = round2(settlementForeignAmount * carryingRatePkr);
  const actualSettlementPkr = round2(settlementForeignAmount * settlementRateToPkr);

  return {
    carryingRatePkr,
    carryingAmountPkr,
    actualSettlementPkr,
    realizedFxPkr: round2(carryingAmountPkr - actualSettlementPkr),
  };
}
