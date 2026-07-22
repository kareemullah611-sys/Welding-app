export type SaleLotAllocationItem = {
  productId: number;
  lotId: number | null;
  stockQty: number;
  cartonQty: number | null;
  ratePerCarton: number;
  ratePerPieceLocal: number | null;
  ratePerPieceUsd: number | null;
  amount?: number;
  amountUsd?: number | null;
};

export type AvailableSaleLot = {
  lotId: number;
  lotNumber: string;
  available: number;
};

export function allocateSaleItemAcrossLots(input: {
  item: SaleLotAllocationItem;
  availableLots: AvailableSaleLot[];
  roundMoney: (value: number) => number;
}): SaleLotAllocationItem[] {
  const { item, availableLots, roundMoney } = input;
  if (item.lotId) {
    const amount = item.ratePerPieceLocal !== null
      ? roundMoney(item.stockQty * item.ratePerPieceLocal)
      : roundMoney(item.stockQty * item.ratePerCarton);
    const amountUsd = item.ratePerPieceUsd !== null ? roundMoney(item.stockQty * item.ratePerPieceUsd) : null;
    return [{ ...item, amount, amountUsd }];
  }

  let remaining = item.stockQty;
  const allocated: SaleLotAllocationItem[] = [];
  for (const lot of availableLots) {
    if (remaining <= 0) break;
    const available = Math.max(0, Number(lot.available || 0));
    if (available <= 0) continue;
    const stockQty = Math.min(remaining, available);
    const cartonQty = item.cartonQty === null || item.stockQty <= 0 ? null : stockQty / (item.stockQty / item.cartonQty);
    const amount = item.ratePerPieceLocal !== null
      ? roundMoney(stockQty * item.ratePerPieceLocal)
      : roundMoney(stockQty * item.ratePerCarton);
    const amountUsd = item.ratePerPieceUsd !== null ? roundMoney(stockQty * item.ratePerPieceUsd) : null;
    allocated.push({ ...item, lotId: lot.lotId, stockQty, cartonQty, amount, amountUsd });
    remaining = roundMoney(remaining - stockQty);
  }

  if (remaining > 0) {
    throw new Error(`Auto lot allocation could not cover ${remaining} cartons/pieces`);
  }

  return allocated;
}
