type SaleRow = Record<string, any> & { items?: any[] };

function mergeDisplayItems(items: any[]): any[] {
  const itemMap = new Map<string, any>();
  for (const item of items) {
    if (!item) continue;
    const lotId = Number(item.lotId || item.lot?.id || 0);
    const key = [
      item.productId || item.product?.id,
      lotId,
      item.ratePerCarton || item.rate || 0,
      item.ratePerPieceLocal || 0,
      item.ratePerPieceUsd || 0,
    ].join(":");
    const current = itemMap.get(key);
    if (current) {
      current.qty = Math.round((Number(current.qty || 0) + Number(item.qty || 0)) * 100) / 100;
      current.cartonQty = item.cartonQty == null && current.cartonQty == null
        ? current.cartonQty
        : Math.round((Number(current.cartonQty || 0) + Number(item.cartonQty || 0)) * 100) / 100;
      current.amount = Math.round((Number(current.amount || 0) + Number(item.amount || 0)) * 100) / 100;
      current.amountUsd = item.amountUsd == null && current.amountUsd == null
        ? current.amountUsd
        : Math.round((Number(current.amountUsd || 0) + Number(item.amountUsd || 0)) * 100) / 100;
    } else {
      itemMap.set(key, { ...item });
    }
  }
  return Array.from(itemMap.values());
}

export function buildSaleDisplayRows(sales: SaleRow[], selectedLotId = 0): SaleRow[] {
  return sales.flatMap((sale) => {
    if (sale.isDisplayRow) return [sale];
    const sourceItems = Array.isArray(sale.items) && sale.items.length > 0 ? sale.items : [null];
    const filteredItems = selectedLotId > 0
      ? sourceItems.filter((item) => item && Number(item.lotId || item.lot?.id || sale.lot?.id || 0) === selectedLotId)
      : sourceItems;
    const items = filteredItems[0] ? mergeDisplayItems(filteredItems) : filteredItems;
    return items.map((item) => {
      if (!item) return { ...sale, isDisplayRow: true, sourceItems: [] };
      const qty = Number(item.qty || item.cartonQty || 0);
      const rate = Number(item.ratePerCarton || item.rate || item.ratePerPieceLocal || 0);
      return {
        ...sale,
        isDisplayRow: true,
        sourceItems,
        sourceTotalAmount: sale.totalAmount,
        items: [item],
        lot: item.lot || sale.lot,
        totalAmount: Number(item.amount ?? qty * rate),
      };
    });
  });
}

export function paginateSaleDisplayRows(
  sales: SaleRow[],
  page: number,
  limit: number,
  selectedLotId = 0,
) {
  const rows = buildSaleDisplayRows(sales, selectedLotId);
  const safePage = Math.max(1, Math.floor(page || 1));
  const safeLimit = Math.max(1, Math.floor(limit || 1));
  const total = rows.length;
  const skip = (safePage - 1) * safeLimit;
  return {
    items: rows.slice(skip, skip + safeLimit),
    total,
    totalPages: Math.max(1, Math.ceil(total / safeLimit)),
  };
}
