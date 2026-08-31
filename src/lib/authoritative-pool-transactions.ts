import type { HistoricalPoolTransaction } from "./historical-pool-attribution";

type JournalPnlLine = {
  id: number;
  transactionId: string;
  entryDate: Date | string;
  currencyCode: string;
  debit: unknown;
  credit: unknown;
  description: string;
  account: { code: string; accountType: string };
};

type RecognizedForeignSale = {
  id: number;
  saleDate: Date | string;
  voucherNo: string;
  fxPkrEquivalent: unknown;
  customerName: string;
};

function dateOnly(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

function amountForLine(line: JournalPnlLine): number | null {
  if (line.currencyCode.toUpperCase() !== "PKR") return null;
  const debit = Number(line.debit || 0);
  const credit = Number(line.credit || 0);
  if (line.account.code === "FX-GAIN" || line.account.code === "FX-LOSS") return credit - debit;
  if (line.account.accountType === "revenue") return credit - debit;
  if (line.account.accountType === "cogs" || line.account.accountType === "expense") return credit - debit;
  return null;
}

export function buildAuthoritativePoolTransactions(input: {
  journalLines: JournalPnlLine[];
  recognizedForeignSales: RecognizedForeignSale[];
  originalPoolDateByTransactionId?: Map<string, string>;
}): HistoricalPoolTransaction[] {
  const journalTransactions = input.journalLines.flatMap((line): HistoricalPoolTransaction[] => {
    const amountPkr = amountForLine(line);
    if (amountPkr == null || amountPkr === 0) return [];
    const recognizedDate = dateOnly(line.entryDate);
    const isFx = line.account.code === "FX-GAIN" || line.account.code === "FX-LOSS";
    return [{
      sourceType: isFx ? "fx_gain_loss" : "other_adjustment",
      sourceId: `journal:${line.id}`,
      recognizedDate,
      originalPoolDate: input.originalPoolDateByTransactionId?.get(line.transactionId) || recognizedDate,
      amountPkr,
      description: `${line.transactionId} · ${line.description}`,
    }];
  });

  const recognizedSaleTransactions = input.recognizedForeignSales.flatMap((sale): HistoricalPoolTransaction[] => {
    const amountPkr = Number(sale.fxPkrEquivalent || 0);
    if (!Number.isFinite(amountPkr) || amountPkr === 0) return [];
    const recognizedDate = dateOnly(sale.saleDate);
    return [{
      sourceType: "sale_profit",
      sourceId: `recognized-sale:${sale.id}`,
      recognizedDate,
      originalPoolDate: recognizedDate,
      amountPkr,
      description: `Recognized foreign sale ${sale.voucherNo} · ${sale.customerName}`,
    }];
  });

  return [...journalTransactions, ...recognizedSaleTransactions];
}
