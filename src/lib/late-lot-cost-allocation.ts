type LateLotCostAllocationInput = {
  amountPkr: number;
  totalCartons: number;
  operatingSoldCartons: number;
  openingSoldCartons: number;
};

export type LateLotCostAllocation = {
  operatingCogsPkr: number;
  historicalAdjustmentPkr: number;
  inventoryPkr: number;
};

function roundPkr(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function allocateLateLotCostPkr(input: LateLotCostAllocationInput): LateLotCostAllocation {
  const { amountPkr, totalCartons, operatingSoldCartons, openingSoldCartons } = input;
  if (!Number.isFinite(amountPkr) || amountPkr < 0) throw new Error("Lot cost amount must be zero or greater");
  if (!Number.isFinite(totalCartons) || totalCartons <= 0) throw new Error("Lot quantity must be greater than zero");
  if (!Number.isFinite(operatingSoldCartons) || operatingSoldCartons < 0) throw new Error("Operating sold quantity is invalid");
  if (!Number.isFinite(openingSoldCartons) || openingSoldCartons < 0) throw new Error("Opening sold quantity is invalid");

  const soldCartons = operatingSoldCartons + openingSoldCartons;
  if (soldCartons > totalCartons + 0.000001) throw new Error("Sold quantities exceed the lot quantity");

  const operatingCogsPkr = roundPkr(amountPkr * operatingSoldCartons / totalCartons);
  const historicalAdjustmentPkr = roundPkr(amountPkr * openingSoldCartons / totalCartons);
  const inventoryPkr = roundPkr(amountPkr - operatingCogsPkr - historicalAdjustmentPkr);

  return { operatingCogsPkr, historicalAdjustmentPkr, inventoryPkr };
}
