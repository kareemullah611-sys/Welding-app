export type HistoricalOpeningAdjustmentPlan = {
  postOperatingCogs: boolean;
  postOpeningAdjustment: boolean;
  openingAdjustmentPkr: number;
  reverseTransactionIds: string[];
  openingAdjustmentTransactionId: string;
};

export function historicalOpeningAdjustmentTransactionId(saleId: number): string {
  return `OPENING-STOCK-COST-${saleId}`;
}

export function buildHistoricalOpeningAdjustmentPlan(input: {
  saleId: number;
  isOpeningImport: boolean;
  proposedCostPkr: number;
  hasSaleJournal: boolean;
  hasSaleReversal?: boolean;
  hasCogsJournal: boolean;
  hasCogsReversal?: boolean;
  hasOpeningAdjustment: boolean;
}): HistoricalOpeningAdjustmentPlan {
  const reverseTransactionIds = input.isOpeningImport
    ? [
        ...(input.hasSaleJournal && !input.hasSaleReversal ? [`SALE-${input.saleId}`] : []),
        ...(input.hasCogsJournal && !input.hasCogsReversal ? [`COGS-${input.saleId}`] : []),
      ]
    : [];

  return {
    postOperatingCogs: !input.isOpeningImport && !input.hasCogsJournal && input.proposedCostPkr > 0,
    postOpeningAdjustment: input.isOpeningImport && !input.hasOpeningAdjustment && input.proposedCostPkr > 0,
    openingAdjustmentPkr: input.isOpeningImport ? input.proposedCostPkr : 0,
    reverseTransactionIds,
    openingAdjustmentTransactionId: historicalOpeningAdjustmentTransactionId(input.saleId),
  };
}
