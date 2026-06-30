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
