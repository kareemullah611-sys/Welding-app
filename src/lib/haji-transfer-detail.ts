const SOURCE_LABELS: Record<string, string> = {
  cash_office: "Cash from Office",
  cheque: "Cheque",
  mixed_cash_cheque: "Cash + Cheques",
  bank_transfer: "Bank Transfer",
};

/** Full account id for PK/AFG haji detail, e.g. mzn-4002 or malik mzn-8235 (matches payments module). */
export function formatHajiDestinationAccountName(account?: {
  bankName?: string | null;
  accountNumber?: string | null;
} | null): string {
  if (!account) return "";
  const name = String(account.bankName || "").trim();
  const acct = String(account.accountNumber || "").trim();
  if (name && acct) return `${name}-${acct}`;
  return name || acct;
}

/** Destination account label from stored transferredTo or linked super-admin account. */
export function getHajiTransferDestinationShortName(
  transferredTo?: string | null,
  destinationAccount?: { bankName?: string | null; accountNumber?: string | null } | null,
): string {
  const fromAccount = formatHajiDestinationAccountName(destinationAccount);
  if (fromAccount) return fromAccount;

  const raw = String(transferredTo || "").trim();
  if (!raw || raw === "Super Admin Account") return "";

  const parenMatch = raw.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    const name = parenMatch[1].trim();
    const acct = parenMatch[2].trim();
    if (name && acct) return `${name}-${acct}`;
    return acct || name;
  }

  return raw;
}

/** PK/AFG city haji list detail: "{dest} transfer" or "{dest} online" — no Direct/customer line. */
export function getCityHajiTransferListDetail(tr: {
  recordType?: string | null;
  sourceType?: string | null;
  transferType?: string | null;
  transferredTo?: string | null;
  destinationAccount?: { bankName?: string | null; accountNumber?: string | null } | null;
}): string {
  const sourceType =
    tr.sourceType ||
    (tr.transferType === "direct" ? "bank_transfer" : tr.transferType === "from_in_hand" ? "cash_office" : null);

  if (tr.recordType === "customer_payment") {
    if (sourceType === "bank_transfer" || sourceType === "online") return "online";
    return "transfer";
  }

  const dest = getHajiTransferDestinationShortName(tr.transferredTo, tr.destinationAccount);
  if (!dest) return "—";

  if (sourceType === "bank_transfer") return `${dest} online`;
  return `${dest} transfer`;
}

export function buildCityHajiTransferDetail(input: {
  sourceType?: string | null;
  transferredTo?: string | null;
  destinationAccount?: { bankName?: string | null; accountNumber?: string | null } | null;
}): string {
  return getCityHajiTransferListDetail({
    sourceType: input.sourceType,
    transferredTo: input.transferredTo,
    destinationAccount: input.destinationAccount,
  });
}

export function formatSuperAdminBankLabel(account: {
  bankName?: string | null;
  accountNumber?: string | null;
}): string {
  const name = String(account.bankName || "").trim();
  const acct = String(account.accountNumber || "").trim();
  if (name && acct) return `${name} (${acct})`;
  return name || acct;
}

export function buildHajiTransferAutoDetail(input: {
  sourceType?: string | null;
  transferredTo?: string | null;
}): string {
  const source = SOURCE_LABELS[String(input.sourceType || "cash_office")] || String(input.sourceType || "Transfer");
  const dest = String(input.transferredTo || "").trim();
  return dest ? `${source} → ${dest}` : source;
}

/** Top line in haji transfers list: Direct for city transfers, customer name when from customer. */
export function getHajiTransferFromLabel(tr: {
  recordType?: string | null;
  sourceType?: string | null;
  transferredTo?: string | null;
  chequeCustomerName?: string | null;
}): string {
  if (tr.recordType === "customer_payment") {
    return String(tr.transferredTo || "").trim() || "Direct";
  }
  if (tr.sourceType === "cheque" || tr.sourceType === "mixed_cash_cheque") {
    return String(tr.chequeCustomerName || "").trim() || "Direct";
  }
  return "Direct";
}

/** Bottom line in haji transfers list: destination / recorded detail, optional ref no. */
export function getHajiTransferDetailLine(tr: {
  detail?: string | null;
  transferredTo?: string | null;
  referenceNo?: string | null;
}): string {
  const ref = String(tr.referenceNo || "").trim();
  let detail = String(tr.detail || "").trim();

  const arrowIdx = detail.indexOf(" → ");
  if (arrowIdx > 0) {
    detail = detail.slice(arrowIdx + 3).trim();
  }

  if (!detail) {
    const dest = String(tr.transferredTo || "").trim();
    if (dest && dest !== "Super Admin Account") detail = dest;
  }

  if (ref) return detail ? `${detail} (${ref})` : ref;
  return detail || "—";
}
