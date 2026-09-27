export function buildInvestorFinalizationIdempotencyKey(
  periodStart: string,
  periodEnd: string,
  existingFinalizationCount: number
) {
  const baseKey = `investor-finalization:${periodStart}:${periodEnd}`;
  return existingFinalizationCount === 0
    ? baseKey
    : `${baseKey}:revision:${existingFinalizationCount + 1}`;
}
