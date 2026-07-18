export type SupplierLotStatementRow = {
  itemNo: number;
  lotId: number;
  invoiceNumber: string;
  marketCountry: string;
  orderDetails: string;
  quantityTons: number;
  amountUsd: number;
  depositUsd: number;
  lotBalanceUsd: number;
  runningBalanceUsd: number;
  status: "settled" | "pending";
  appliedPayments: Array<{
    paymentId: number;
    date: string;
    amountUsd: number;
    reference: string | null;
  }>;
  date: string;
};

export type SupplierRunningLedgerRow = {
  date: string;
  particulars: string;
  debitUsd: number;
  creditUsd: number;
  balanceUsd: number;
  sourceType: "purchase" | "payment" | "haji_party_deposit";
  sourceId: number;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function buildSupplierStatement(supplier: {
  lotPurchases?: any[];
  supplierPayments?: any[];
  hajiDestinationTransfers?: any[];
}): { rows: SupplierLotStatementRow[]; nextLotToPay: SupplierLotStatementRow | null } {
  const byLot = new Map<
    number,
    {
      lotId: number;
      invoiceNumber: string;
      marketCountry: string;
      lotDate: Date;
      orderDetails: string[];
      quantityTons: number;
      amountUsd: number;
      appliedUsd: number;
      appliedPayments: SupplierLotStatementRow["appliedPayments"];
    }
  >();

  for (const purchase of supplier.lotPurchases || []) {
    const lotId = Number(purchase.lotId);
    const existing = byLot.get(lotId);
    const qty = num(purchase.qty);
    const amountUsd = num(purchase.totalPriceUsd);
    const detailLine = `${purchase.product?.name || "Product"} ${qty}MT`;
    if (existing) {
      existing.quantityTons += qty;
      existing.amountUsd += amountUsd;
      existing.orderDetails.push(detailLine);
      continue;
    }
    byLot.set(lotId, {
      lotId,
      invoiceNumber: purchase.lot?.lotNumber || `LOT-${lotId}`,
      marketCountry: purchase.lot?.country?.name || "-",
      lotDate: new Date(purchase.lot?.lotDate || purchase.createdAt),
      orderDetails: [detailLine],
      quantityTons: qty,
      amountUsd,
      appliedUsd: 0,
      appliedPayments: [],
    });
  }

  const rowsInternal = Array.from(byLot.values()).sort((a, b) => a.lotDate.getTime() - b.lotDate.getTime());

  const sortedPayments = [
    ...(supplier.supplierPayments || []).map((payment) => ({
      id: payment.id,
      paymentDate: payment.paymentDate,
      amountUsd: payment.amountUsd,
      lotId: payment.lotId,
      reference: payment.reference,
    })),
    ...(supplier.hajiDestinationTransfers || []).map((transfer) => ({
      id: transfer.id,
      paymentDate: transfer.transferDate,
      amountUsd: transfer.amount,
      lotId: transfer.lotId,
      reference: transfer.referenceNo,
    })),
  ].sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime());

  for (const payment of sortedPayments) {
    let remaining = num(payment.amountUsd);
    if (remaining <= 0) continue;

    const targetLotId = payment.lotId ? Number(payment.lotId) : null;
    const applyOrder =
      targetLotId && byLot.has(targetLotId)
        ? [byLot.get(targetLotId)!, ...rowsInternal.filter((r) => r.lotId !== targetLotId)]
        : rowsInternal;

    for (const target of applyOrder) {
      if (remaining <= 0.00001) break;
      const pending = target.amountUsd - target.appliedUsd;
      if (pending <= 0.00001) continue;
      const appliedNow = Math.min(pending, remaining);
      target.appliedUsd += appliedNow;
      remaining -= appliedNow;
      target.appliedPayments.push({
        paymentId: Number(payment.id),
        date: new Date(payment.paymentDate).toISOString().split("T")[0],
        amountUsd: round2(appliedNow),
        reference: payment.reference || null,
      });
    }
  }

  let runningBalance = 0;
  const rows: SupplierLotStatementRow[] = rowsInternal.map((row, index) => {
    const lotBalance = Math.max(0, round2(row.amountUsd - row.appliedUsd));
    runningBalance = round2(runningBalance + lotBalance);
    return {
      itemNo: index + 1,
      lotId: row.lotId,
      invoiceNumber: row.invoiceNumber,
      marketCountry: row.marketCountry,
      orderDetails: row.orderDetails.join(" · "),
      quantityTons: round2(row.quantityTons),
      amountUsd: round2(row.amountUsd),
      depositUsd: round2(row.appliedUsd),
      lotBalanceUsd: lotBalance,
      runningBalanceUsd: runningBalance,
      status: lotBalance <= 0 ? "settled" : "pending",
      appliedPayments: row.appliedPayments,
      date: row.lotDate.toISOString().split("T")[0],
    };
  });

  const nextLotToPay = rows.find((r) => r.lotBalanceUsd > 0) || null;
  return { rows, nextLotToPay };
}

export function buildSupplierRunningLedger(supplier: {
  lotPurchases?: any[];
  supplierPayments?: any[];
  hajiDestinationTransfers?: any[];
}): SupplierRunningLedgerRow[] {
  const lotDebits = new Map<number, { date: Date; lotNumber: string; amountUsd: number }>();

  for (const p of supplier.lotPurchases || []) {
    const lotId = Number(p.lotId);
    const existing = lotDebits.get(lotId);
    const amount = num(p.totalPriceUsd);
    if (existing) {
      existing.amountUsd += amount;
      continue;
    }
    lotDebits.set(lotId, {
      date: new Date(p.lot?.lotDate || p.createdAt),
      lotNumber: p.lot?.lotNumber || `LOT-${lotId}`,
      amountUsd: amount,
    });
  }

  const entries: Array<Omit<SupplierRunningLedgerRow, "balanceUsd">> = [];

  for (const [lotId, lot] of lotDebits) {
    entries.push({
      date: lot.date.toISOString().split("T")[0],
      particulars: `Purchase — Lot ${lot.lotNumber}`,
      debitUsd: round2(lot.amountUsd),
      creditUsd: 0,
      sourceType: "purchase",
      sourceId: lotId,
    });
  }

  for (const p of supplier.supplierPayments || []) {
    entries.push({
      date: new Date(p.paymentDate).toISOString().split("T")[0],
      particulars: `Payment${p.lot?.lotNumber ? ` — Lot ${p.lot.lotNumber}` : ""}${p.reference ? ` (${p.reference})` : ""}`,
      debitUsd: 0,
      creditUsd: round2(num(p.amountUsd)),
      sourceType: "payment",
      sourceId: Number(p.id),
    });
  }

  for (const h of supplier.hajiDestinationTransfers || []) {
    entries.push({
      date: new Date(h.transferDate).toISOString().split("T")[0],
      particulars: `Haji party deposit${h.lot?.lotNumber ? ` — Lot ${h.lot.lotNumber}` : ""}${h.referenceNo ? ` (${h.referenceNo})` : ""}`,
      debitUsd: 0,
      creditUsd: round2(num(h.amount)),
      sourceType: "haji_party_deposit",
      sourceId: Number(h.id),
    });
  }

  entries.sort((a, b) => a.date.localeCompare(b.date) || a.sourceId - b.sourceId);

  let balance = 0;
  return entries.map((e) => {
    balance = round2(balance + e.debitUsd - e.creditUsd);
    return { ...e, balanceUsd: balance };
  });
}
