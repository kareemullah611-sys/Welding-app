export function applyOpeningByCurrency(
  base: Record<string, number>,
  opening: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = { ...base };
  for (const [currency, amount] of Object.entries(opening)) {
    merged[currency] = (merged[currency] || 0) + Number(amount || 0);
  }
  return merged;
}

export function computeAvailableStockWithOpening(input: {
  openingQty?: number;
  receivedQty?: number;
  soldQty?: number;
  transferredOutQty?: number;
  transferredInQty?: number;
}): number {
  return Number(input.openingQty || 0)
    + Number(input.receivedQty || 0)
    - Number(input.soldQty || 0)
    - Number(input.transferredOutQty || 0)
    + Number(input.transferredInQty || 0);
}
