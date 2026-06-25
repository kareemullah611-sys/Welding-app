export type IntermediaryLedgerEntryType =
  | "deposit"
  | "payment"
  | "exchange_out"
  | "exchange_in"
  | "haji_transfer"
  | "haji_cash_receipt";

export type IntermediaryLedgerEntry = {
  date: Date;
  type: IntermediaryLedgerEntryType;
  id: number;
  description: string;
  currencyCode: string;
  debit: number;
  credit: number;
  sourceType?: string;
  currencyId?: number;
  superAdminBankAccountId?: number | null;
  notes?: string | null;
};

type DepositRow = {
  id: number;
  depositDate: Date;
  amount: unknown;
  notes?: string | null;
  sourceType?: string;
  currencyId?: number;
  superAdminBankAccountId?: number | null;
  currency: { code: string };
  city?: { name: string } | null;
  bankAccount?: { bankName: string } | null;
  superAdminBankAccount?: { bankName: string } | null;
};

type PaymentRow = {
  id: number;
  paymentDate: Date;
  amountUsd: unknown;
  notes?: string | null;
  supplier: { name: string };
};

type ExchangeRow = {
  id: number;
  exchangeDate: Date;
  fromAmount: unknown;
  toAmount: unknown;
  exchangeRate: unknown;
  notes?: string | null;
  baseCurrency?: { code: string } | null;
  quoteCurrency?: { code: string } | null;
  fromCurrency: { code: string };
  toCurrency: { code: string };
};

type HajiTransferRow = {
  id: number;
  transferDate: Date;
  amount: unknown;
  detail: string;
  notes?: string | null;
  currency: { code: string };
  city: { name: string };
};

type HajiCashReceiptRow = {
  id: number;
  receiptDate: Date;
  amount: unknown;
  notes?: string | null;
  currency: { code: string };
  superAdminCashAccount?: { bankName: string } | null;
};

export function formatHajiTransferLedgerDescription(cityName: string, detail?: string | null) {
  const city = cityName.trim();
  const text = String(detail || "").trim();
  return text ? `${city} — ${text}` : city;
}

export function formatExchangeRate(rate: unknown) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return String(rate ?? "");
  return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function formatExchangeLedgerDescription(
  fromCode: string,
  toCode: string,
  exchangeRate: unknown,
  notes?: string | null,
) {
  const label = `FX ${fromCode}→${toCode} @ ${formatExchangeRate(exchangeRate)}`;
  const note = String(notes || "").trim();
  return note ? `${label} — ${note}` : label;
}

export function buildIntermediaryLedgerEntries(input: {
  deposits: DepositRow[];
  payments: PaymentRow[];
  exchanges: ExchangeRow[];
  hajiTransfers: HajiTransferRow[];
  hajiCashReceipts?: HajiCashReceiptRow[];
}): IntermediaryLedgerEntry[] {
  const { deposits, payments, exchanges, hajiTransfers, hajiCashReceipts = [] } = input;

  return [
    ...deposits.map((d) => ({
      date: d.depositDate,
      type: "deposit" as const,
      id: d.id,
      description: `Deposit${d.city ? ` (${d.city.name})` : ""}${d.bankAccount ? ` via ${d.bankAccount.bankName}` : ""}${d.superAdminBankAccount ? ` via ${d.superAdminBankAccount.bankName}` : ""}${d.notes ? ` — ${d.notes}` : ""}`,
      currencyCode: d.currency.code,
      debit: 0,
      credit: Number(d.amount),
      sourceType: d.sourceType,
      currencyId: d.currencyId,
      superAdminBankAccountId: d.superAdminBankAccountId,
      notes: d.notes,
    })),
    ...payments.map((p) => ({
      date: p.paymentDate,
      type: "payment" as const,
      id: p.id,
      description: `Supplier payment — ${p.supplier.name}${p.notes ? ` — ${p.notes}` : ""}`,
      currencyCode: "USD",
      debit: Number(p.amountUsd),
      credit: 0,
    })),
    ...exchanges.flatMap((e) => {
      const description = formatExchangeLedgerDescription(
        e.fromCurrency.code,
        e.toCurrency.code,
        e.exchangeRate,
        e.notes,
      );
      return [
      {
        date: e.exchangeDate,
        type: "exchange_out" as const,
        id: e.id,
        description,
        currencyCode: e.fromCurrency.code,
        debit: 0,
        credit: Number(e.fromAmount),
      },
      {
        date: e.exchangeDate,
        type: "exchange_in" as const,
        id: e.id,
        description,
        currencyCode: e.toCurrency.code,
        debit: Number(e.toAmount),
        credit: 0,
      },
    ];
    }),
    ...hajiTransfers.map((h) => ({
      date: h.transferDate,
      type: "haji_transfer" as const,
      id: h.id,
      description: formatHajiTransferLedgerDescription(h.city.name, h.detail),
      currencyCode: h.currency.code,
      debit: 0,
      credit: Number(h.amount),
    })),
    ...hajiCashReceipts.map((r) => ({
      date: r.receiptDate,
      type: "haji_cash_receipt" as const,
      id: r.id,
      description: `Haji cash${r.superAdminCashAccount?.bankName ? ` — ${r.superAdminCashAccount.bankName}` : ""}${r.notes ? ` — ${r.notes}` : ""}`,
      currencyCode: r.currency.code,
      debit: Number(r.amount),
      credit: 0,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

export function paginateIntermediaryLedger(
  entries: IntermediaryLedgerEntry[],
  page: number,
  limit: number,
) {
  const total = entries.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const skip = (page - 1) * limit;

  const balances: Record<string, number> = {};
  const ledger = entries.map((entry) => {
    balances[entry.currencyCode] = (balances[entry.currencyCode] || 0) + entry.debit - entry.credit;
    return { ...entry, balance: balances[entry.currencyCode] };
  });

  return {
    ledger: ledger.slice(skip, skip + limit),
    balances,
    pagination: { page, limit, totalPages, total },
  };
}
