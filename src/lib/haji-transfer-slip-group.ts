export type HajiTransferListRow = {
  id: number;
  recordType?: string | null;
  cityId?: number;
  lotId?: number;
  transferDate?: string;
  referenceNo?: string | null;
  transferredTo?: string | null;
  detail?: string | null;
  sourceType?: string | null;
  transferType?: string | null;
  amount?: number;
  superAdminBankAccountId?: number | null;
  superAdminCashAccountId?: number | null;
  currency?: { id?: number; code?: string; symbol?: string };
  slipTransferIds?: number[];
  [key: string]: unknown;
};

function isSlipPartRow(row: HajiTransferListRow): boolean {
  if (row.recordType && row.recordType !== "haji_transfer") return false;
  const sourceType = row.sourceType || "";
  return sourceType === "cash_office" || sourceType === "cheque";
}

export function buildHajiTransferSlipGroupKey(row: HajiTransferListRow): string {
  return [
    row.cityId ?? "",
    row.lotId ?? "",
    row.transferDate ?? "",
    row.referenceNo ?? "",
    row.transferredTo ?? "",
    row.detail ?? "",
    row.superAdminBankAccountId ?? "",
    row.superAdminCashAccountId ?? "",
  ].join("|");
}

function mergeSlipGroup(group: HajiTransferListRow[]): HajiTransferListRow {
  const sorted = [...group].sort((a, b) => a.id - b.id);
  const primary = sorted[0];
  const slipTransferIds = sorted.map((row) => row.id);
  const totalAmount = sorted.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const sourceTypes = new Set(sorted.map((row) => row.sourceType));

  let sourceType = primary.sourceType;
  if (sourceTypes.has("cheque") && sourceTypes.has("cash_office")) {
    sourceType = "mixed_cash_cheque";
  }

  return {
    ...primary,
    id: Math.max(...slipTransferIds),
    amount: totalAmount,
    sourceType,
    slipTransferIds,
  };
}

function canMergeSlipGroup(group: HajiTransferListRow[]): boolean {
  if (group.length <= 1) return false;
  if (!group.every(isSlipPartRow)) return false;
  const currencyCode = group[0].currency?.code;
  if (!currencyCode) return false;
  return group.every((row) => row.currency?.code === currencyCode);
}

/** Merge cash + cheque rows from one slip into a single list row. */
export function groupHajiTransferSlipRows(rows: HajiTransferListRow[]): HajiTransferListRow[] {
  const hajiRows: HajiTransferListRow[] = [];
  const otherRows: HajiTransferListRow[] = [];

  for (const row of rows) {
    if (row.recordType === "customer_payment") otherRows.push(row);
    else hajiRows.push(row);
  }

  const buckets = new Map<string, HajiTransferListRow[]>();
  for (const row of hajiRows) {
    const key = buildHajiTransferSlipGroupKey(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const mergedHajiRows: HajiTransferListRow[] = [];
  for (const group of buckets.values()) {
    mergedHajiRows.push(canMergeSlipGroup(group) ? mergeSlipGroup(group) : group[0]);
    if (!canMergeSlipGroup(group) && group.length > 1) {
      for (let i = 1; i < group.length; i++) mergedHajiRows.push(group[i]);
    }
  }

  return [...mergedHajiRows, ...otherRows];
}

export function getHajiTransferSlipDeleteIds(item: HajiTransferListRow): number[] {
  if (Array.isArray(item.slipTransferIds) && item.slipTransferIds.length > 0) {
    return item.slipTransferIds;
  }
  if (typeof item.id === "number" && Number.isFinite(item.id)) return [item.id];
  return [];
}

export function isGroupedHajiTransferSlip(item: HajiTransferListRow): boolean {
  return Array.isArray(item.slipTransferIds) && item.slipTransferIds.length > 1;
}
