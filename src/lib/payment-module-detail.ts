const METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
  cheque: "Cheque",
  online: "Online",
};

type BankLike = { bankName?: string | null; accountNumber?: string | null } | null | undefined;

/** Account id for PK city payment detail, e.g. mzn-4002 */
export function formatPaymentAccountName(account?: BankLike): string {
  const name = String(account?.bankName || "").trim();
  const acct = String(account?.accountNumber || "").trim();
  if (name && acct) return `${name}-${acct}`;
  return name || acct;
}

export function getPakistanPaymentAccountSelectValue(form: {
  bankAccountId?: number | null;
  superAdminBankAccountId?: number | null;
}): string {
  if (form.superAdminBankAccountId) return `super-${form.superAdminBankAccountId}`;
  if (form.bankAccountId) return `city-${form.bankAccountId}`;
  return "";
}

export function parsePakistanPaymentAccountSelectValue(value: string): {
  destination: "our_account" | "haji";
  bankAccountId: number;
  superAdminBankAccountId: number;
} {
  const [scope, idStr] = String(value || "").split("-");
  const id = parseInt(idStr, 10) || 0;
  if (scope === "super" && id) {
    return { destination: "haji", bankAccountId: 0, superAdminBankAccountId: id };
  }
  if (scope === "city" && id) {
    return { destination: "our_account", bankAccountId: id, superAdminBankAccountId: 0 };
  }
  return { destination: "our_account", bankAccountId: 0, superAdminBankAccountId: 0 };
}

export function getPakistanPkrCurrencyId(
  currencies: Array<{ id?: number; code?: string }>,
): number {
  const pkr = currencies.find((currency) => String(currency.code || "").toUpperCase() === "PKR");
  return pkr?.id || 0;
}

export function isPakistanPkrPaymentCurrency(
  paymentCurrencyId: number,
  currencies: Array<{ id?: number; code?: string }>,
): boolean {
  const pkrCurrencyId = getPakistanPkrCurrencyId(currencies);
  return pkrCurrencyId > 0 && paymentCurrencyId === pkrCurrencyId;
}

export function isPakistanPkrSuperAdminBankAccount(
  account: { currency?: { code?: string | null; id?: number }; currencyId?: number | null },
  pkrCurrencyId: number,
): boolean {
  if (String(account.currency?.code || "").toUpperCase() === "PKR") return true;
  return pkrCurrencyId > 0 && account.currencyId === pkrCurrencyId;
}

/** PK city treasury + super-admin accounts for bank/online payments (PKR only). */
export function buildPakistanPaymentAccountOptions(input: {
  paymentCurrencyId: number;
  currencies: Array<{ id?: number; code?: string }>;
  cityBankAccounts: Array<{ id?: number; isActive?: boolean; bankName?: string; accountNumber?: string }>;
  superAdminBankAccounts: Array<{
    id?: number;
    isActive?: boolean;
    bankName?: string;
    accountNumber?: string;
    currency?: { code?: string | null; id?: number };
    currencyId?: number | null;
  }>;
}): Array<{ key: string; label: string }> {
  const pkrCurrencyId = getPakistanPkrCurrencyId(input.currencies);
  if (!isPakistanPkrPaymentCurrency(input.paymentCurrencyId, input.currencies)) {
    return [];
  }

  return [
    ...input.cityBankAccounts
      .filter((account) => account.isActive !== false)
      .map((account) => ({
        key: `city-${account.id}`,
        label: formatPaymentAccountName(account),
      })),
    ...input.superAdminBankAccounts
      .filter((account) => account.isActive !== false && isPakistanPkrSuperAdminBankAccount(account, pkrCurrencyId))
      .map((account) => ({
        key: `super-${account.id}`,
        label: formatPaymentAccountName(account),
      })),
  ];
}

/** PK city payments list/create detail: mzn-4002 transfer | mzn-4002 online */
export function formatPakistanCityPaymentDetail(payment: {
  paymentMethod?: string | null;
  destination?: string | null;
  bankAccount?: BankLike;
  superAdminBankAccount?: BankLike;
}): string {
  const method = String(payment.paymentMethod || "cash");
  if (method === "bank_transfer" || method === "online") {
    const bank = payment.destination === "haji"
      ? payment.superAdminBankAccount
      : payment.bankAccount;
    const accountId = formatPaymentAccountName(bank);
    const suffix = method === "bank_transfer" ? "transfer" : "online";
    return accountId ? `${accountId} ${suffix}` : suffix;
  }
  if (method === "cash") {
    const dest = payment.destination === "haji" ? "haji" : "office";
    return `cash to ${dest}`;
  }
  if (method === "cheque") return "cheque";
  return method.replace(/_/g, " ");
}

/** Payments list detail, e.g. malik mzn-8235 Online (4564) or cash to office */
export function formatPaymentModuleDetail(payment: {
  paymentMethod?: string | null;
  destination?: string | null;
  manualVoucherNo?: string | null;
  chequeNumber?: string | null;
  bankAccount?: BankLike;
  superAdminBankAccount?: BankLike;
}): string {
  const method = String(payment.paymentMethod || "cash");
  const ref = String(payment.manualVoucherNo || payment.chequeNumber || "").trim();
  const methodLabel = METHOD_LABELS[method] || method.replace(/_/g, " ");

  if (method === "cash") {
    const dest = payment.destination === "haji" ? "haji" : "office";
    const core = `cash to ${dest}`;
    return ref ? `${core} (${ref})` : core;
  }

  const bank = payment.destination === "haji"
    ? payment.superAdminBankAccount
    : payment.bankAccount;

  if (bank?.bankName || bank?.accountNumber) {
    const name = String(bank.bankName || "").trim();
    const acct = String(bank.accountNumber || "").trim();
    const destPart = name && acct ? `${name}-${acct}` : name || acct;
    return ref ? `${destPart} ${methodLabel} (${ref})` : `${destPart} ${methodLabel}`;
  }

  const dest = payment.destination === "haji" ? "haji" : "office";
  const core = `${methodLabel} to ${dest}`;
  return ref ? `${core} (${ref})` : core;
}

export function formatAfghanistanCityPaymentDetail(input: {
  customerName?: string | null;
  targetName?: string | null;
  manualVoucherNo?: string | null;
}): string {
  const targetName = String(input.targetName || "").trim();
  const customerName = String(input.customerName || "Customer").trim() || "Customer";
  const ref = String(input.manualVoucherNo || "").trim();
  const core = targetName || `cash-${customerName}`;
  return ref ? `${core} Ref ${ref}` : core;
}

/** Super-admin haji payments list: meezan (4002)-bank transfer */
export function formatSuperAdminPaymentDetail(payment: {
  paymentMethod?: string | null;
  superAdminBankAccount?: BankLike;
}): string {
  const bank = payment.superAdminBankAccount;
  const name = String(bank?.bankName || "").trim().toLowerCase();
  const acct = String(bank?.accountNumber || "").trim();
  const dest = acct ? `${name} (${acct})` : name;
  const method = String(payment.paymentMethod || "cash").replace(/_/g, " ");
  return dest ? `${dest}-${method}` : method;
}

export function buildPaymentSubmitPayload(
  form: Record<string, unknown>,
  options: {
    currencyId: number;
    cityBankAccounts?: Array<{ id?: number; bankName?: string; accountNumber?: string }>;
    superAdminBankAccounts?: Array<{ id?: number; bankName?: string; accountNumber?: string }>;
  },
) {
  const method = String(form.paymentMethod || "cash");
  let destination: string = ["cash", "cheque"].includes(method) ? "our_account" : String(form.destination || "our_account");
  const bankAccount = options.cityBankAccounts?.find((a) => a.id === form.bankAccountId);
  const superAdminBankAccount = options.superAdminBankAccounts?.find((a) => a.id === form.superAdminBankAccountId);
  if (["bank_transfer", "online"].includes(method)) {
    if (form.superAdminBankAccountId) destination = "haji";
    else if (form.bankAccountId) destination = "our_account";
  }
  const detail = formatPakistanCityPaymentDetail({
    paymentMethod: method,
    destination,
    bankAccount,
    superAdminBankAccount,
  });
  return sanitizePaymentSubmitPayload({ ...form, currencyId: options.currencyId, paymentMethod: method, destination, detail });
}

export function sanitizePaymentSubmitPayload<T extends Record<string, unknown>>(payload: T): T {
  const next = { ...payload };
  if (!Number(next.bankAccountId || 0)) delete next.bankAccountId;
  if (!Number(next.superAdminBankAccountId || 0)) delete next.superAdminBankAccountId;
  return next;
}

export function validatePakistanPaymentForm(form: Record<string, unknown>): string | null {
  const amount = Number(form.amount);
  if (!form.customerId || !Number.isFinite(amount) || amount === 0) {
    return "Customer and non-zero amount are required";
  }
  const method = String(form.paymentMethod || "cash");
  if (["bank_transfer", "online"].includes(method)) {
    if (!form.bankAccountId && !form.superAdminBankAccountId) {
      return "Select an account";
    }
  }
  return null;
}
