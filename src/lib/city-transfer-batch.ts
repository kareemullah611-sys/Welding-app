export type CityTransferSourceInput = {
  fromGodownId: number;
  qty: number;
  lotId?: number | null;
};

export type CityTransferItemInput = {
  productId: number;
  sources: CityTransferSourceInput[];
};

export type NormalizedCityTransferRequest = {
  toCityId: number;
  transferDate?: string;
  notes?: string;
  items: CityTransferItemInput[];
};

export function normalizeCityTransferRequest(body: any): NormalizedCityTransferRequest {
  const rawItems = Array.isArray(body?.items) && body.items.length > 0
    ? body.items
    : [{
        productId: body?.productId,
        sources: [{ fromGodownId: body?.fromGodownId, qty: body?.qty, lotId: body?.lotId }],
      }];

  return {
    toCityId: Number(body?.toCityId || 0),
    transferDate: body?.transferDate ? String(body.transferDate) : undefined,
    notes: body?.notes == null ? undefined : String(body.notes),
    items: rawItems.map((item: any) => ({
      productId: Number(item?.productId || 0),
      sources: (Array.isArray(item?.sources) ? item.sources : []).map((source: any) => ({
        fromGodownId: Number(source?.fromGodownId || 0),
        qty: Number(source?.qty || 0),
        lotId: source?.lotId ? Number(source.lotId) : null,
      })),
    })),
  };
}

export function groupCityTransferRows(rows: any[]) {
  const batches = new Map<string, any>();
  for (const row of rows) {
    const key = row.batchId || `legacy-${row.id}`;
    let batch = batches.get(key);
    if (!batch) {
      batch = {
        ...row,
        batchId: row.batchId || null,
        transferIds: [],
        items: [],
        qty: 0,
      };
      batches.set(key, batch);
    }
    batch.transferIds.push(row.id);
    let item = batch.items.find((candidate: any) => Number(candidate.product?.id) === Number(row.product?.id));
    if (!item) {
      item = { product: row.product, qty: 0, sources: [] };
      batch.items.push(item);
    }
    item.qty += Number(row.qty || 0);
    item.sources.push({ fromGodown: row.fromGodown, lot: row.lot, qty: Number(row.qty || 0) });
    batch.qty += Number(row.qty || 0);
  }

  return Array.from(batches.values()).map((batch) => ({
    ...batch,
    product: batch.items.length === 1 ? batch.items[0].product : { name: `${batch.items.length} products` },
    fromGodown: batch.items.length === 1 && batch.items[0].sources.length === 1
      ? batch.items[0].sources[0].fromGodown
      : { name: `${new Set(batch.items.flatMap((item: any) => item.sources.map((source: any) => source.fromGodown?.id))).size} godowns` },
    lot: batch.items.length === 1 && batch.items[0].sources.length === 1 ? batch.items[0].sources[0].lot : null,
  }));
}
