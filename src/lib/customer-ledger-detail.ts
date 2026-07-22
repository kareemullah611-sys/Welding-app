/** Customer ledger payment detail: cash-office (879) */
export function formatCustomerLedgerPaymentDetail(payment: {
  paymentMethod?: string | null;
  destination?: string | null;
  manualVoucherNo?: string | null;
  chequeNumber?: string | null;
}): string {
  const method = String(payment.paymentMethod || "cash").replace(/_/g, "-");
  const destination = payment.destination === "our_account"
    ? "office"
    : String(payment.destination || "").replace(/_/g, "-");
  const ref = String(payment.manualVoucherNo || payment.chequeNumber || "").trim();
  const core = `${method}-${destination}`;
  return ref ? `${core} (${ref})` : core;
}

type CustomerLedgerSaleItem = {
  product?: { name?: string | null } | null;
  productName?: string | null;
  qty?: unknown;
  cartonQty?: unknown;
  ratePerCarton?: unknown;
};

const formatSaleNumber = (value: number) =>
  value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });

function saleItemQuantity(item: CustomerLedgerSaleItem) {
  const cartonQty = Number(item.cartonQty);
  if (Number.isFinite(cartonQty) && cartonQty > 0) return cartonQty;
  const qty = Number(item.qty);
  return Number.isFinite(qty) ? qty : 0;
}

function saleItemRate(item: CustomerLedgerSaleItem) {
  const rate = Number(item.ratePerCarton);
  return Number.isFinite(rate) ? rate : null;
}

export function formatCustomerLedgerSaleDetail(items: CustomerLedgerSaleItem[]): string {
  return items
    .map((item) => {
      const name = String(item.product?.name || item.productName || "").trim();
      if (!name) return "";
      const rate = saleItemRate(item);
      const base = `${name} × ${formatSaleNumber(saleItemQuantity(item))}`;
      return rate === null ? base : `${base} @ ${formatSaleNumber(rate)}`;
    })
    .filter(Boolean)
    .join(", ");
}

export function formatCustomerLedgerSaleRate(items: CustomerLedgerSaleItem[]): string {
  const rates = items
    .map(saleItemRate)
    .filter((rate): rate is number => rate !== null)
    .map((rate) => Math.round(rate * 100) / 100);
  if (!rates.length) return "-";
  const uniqueRates = Array.from(new Set(rates)).sort((a, b) => a - b);
  if (uniqueRates.length === 1) return `@ ${formatSaleNumber(uniqueRates[0])}`;
  return `@ ${formatSaleNumber(uniqueRates[0])} - ${formatSaleNumber(uniqueRates[uniqueRates.length - 1])}`;
}
