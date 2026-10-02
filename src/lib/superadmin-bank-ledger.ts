export type SuperAdminBankJournalLine = {
  id: number;
  transactionId: string;
  debit: unknown;
  credit: unknown;
  currencyCode: string;
  description: string;
  entityType?: string | null;
  entryDate: Date;
  createdAt: Date;
};

export function buildSuperAdminBankJournalRows(entries: SuperAdminBankJournalLine[]) {
  return entries.map((entry) => ({
    key: `journal-${entry.id}`,
    date: new Date(entry.entryDate),
    createdAt: new Date(entry.createdAt),
    type: entry.entityType
      ? entry.entityType.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
      : "Journal Entry",
    detail: entry.description,
    reference: entry.transactionId,
    currencyCode: String(entry.currencyCode || "PKR").toUpperCase() === "RMB" ? "CNY" : String(entry.currencyCode || "PKR").toUpperCase(),
    credit: Number(entry.debit || 0),
    debit: Number(entry.credit || 0),
  }));
}
