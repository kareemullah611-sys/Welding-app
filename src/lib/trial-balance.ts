import { classifyAccount, getFamilyDef, ACCOUNT_TYPE_ORDER, ACCOUNT_TYPE_LABELS, type AccountFamily } from "./account-grouping";

export type TrialBalanceRow = {
  accountId: number;
  accountCode: string;
  accountName: string;
  accountType: string;
  family: AccountFamily;
  familyLabel: string;
  currencyCode: string;
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
  depth: number;
  parentId: number | null;
  isParentRow: boolean;
  hasDirectEntries: boolean;
  direct: {
    openingDebit: number;
    openingCredit: number;
    periodDebit: number;
    periodCredit: number;
    closingDebit: number;
    closingCredit: number;
  };
};

export type TrialBalanceGroup = {
  family: AccountFamily;
  familyLabel: string;
  accountType: string;
  sortOrder: number;
  rows: TrialBalanceRow[];
  totals: CurrencyTotals;
};

export type TrialBalanceSection = {
  accountType: string;
  label: string;
  sortOrder: number;
  groups: TrialBalanceGroup[];
};

export type CurrencyTotals = Record<string, {
  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;
}>;

export type TrialBalanceResult = {
  sections: TrialBalanceSection[];
  currencyTotals: CurrencyTotals;
  reconciliation: Array<{
    currency: string;
    openingDiff: number;
    periodDiff: number;
    closingDiff: number;
    balanced: boolean;
  }>;
  allBalanced: boolean;
};

export type JournalGroupEntry = {
  accountId: number;
  currencyCode: string;
  _sum: { debit: unknown; credit: unknown };
};

export type AccountInfo = {
  id: number;
  code: string;
  name: string;
  accountType: string;
  parentId?: number | null;
  hasDirectEntries?: boolean;
};

export class AccountHierarchyError extends Error {
  reasons: string[];
  constructor(reasons: string[]) {
    super(`Account hierarchy invalid: ${reasons.join("; ")}`);
    this.name = "AccountHierarchyError";
    this.reasons = reasons;
  }
}

export function validateAccountHierarchy(accounts: AccountInfo[]): void {
  const map = new Map<number, AccountInfo>();
  for (const a of accounts) map.set(a.id, a);

  const reasons = new Set<string>();
  for (const a of accounts) {
    if (a.parentId == null) continue;
    if (a.parentId === a.id) {
      reasons.add(`Account ${a.code} is its own parent`);
      continue;
    }
    const parent = map.get(a.parentId);
    if (!parent) {
      reasons.add(`Account ${a.code} references missing parent id ${a.parentId}`);
      continue;
    }
    if (parent.accountType !== a.accountType) {
      reasons.add(`Account ${a.code} (${a.accountType}) accountType mismatch with parent ${parent.code} (${parent.accountType})`);
    }
    const seen = new Set<number>([a.id]);
    let cur: AccountInfo | undefined = parent;
    while (cur && cur.parentId != null) {
      if (seen.has(cur.id)) {
        reasons.add(`Hierarchy cycle detected at account ${a.code}`);
        break;
      }
      seen.add(cur.id);
      cur = map.get(cur.parentId);
      if (!cur) break;
    }
  }

  if (reasons.size > 0) throw new AccountHierarchyError([...reasons]);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toNum(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  if (typeof v === "object" && typeof (v as any).toNumber === "function") return (v as any).toNumber();
  return Number(v) || 0;
}

function normalizeCurrency(code: string): string {
  const upper = (code || "PKR").toUpperCase();
  return upper === "RMB" ? "CNY" : upper;
}

function addCurrencyTotals(
  target: CurrencyTotals,
  currency: string,
  values: { openingDebit: number; openingCredit: number; periodDebit: number; periodCredit: number; closingDebit: number; closingCredit: number },
) {
  if (!target[currency]) {
    target[currency] = { openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, closingDebit: 0, closingCredit: 0 };
  }
  const t = target[currency];
  t.openingDebit = round2(t.openingDebit + values.openingDebit);
  t.openingCredit = round2(t.openingCredit + values.openingCredit);
  t.periodDebit = round2(t.periodDebit + values.periodDebit);
  t.periodCredit = round2(t.periodCredit + values.periodCredit);
  t.closingDebit = round2(t.closingDebit + values.closingDebit);
  t.closingCredit = round2(t.closingCredit + values.closingCredit);
}

export function buildTrialBalance(input: {
  accounts: AccountInfo[];
  openingGroups: JournalGroupEntry[];
  periodGroups: JournalGroupEntry[];
}): TrialBalanceResult {
  validateAccountHierarchy(input.accounts);

  const accountMap = new Map<number, AccountInfo>();
  for (const a of input.accounts) accountMap.set(a.id, a);

  const openingMap = new Map<string, { debit: number; credit: number }>();
  for (const g of input.openingGroups) {
    const key = `${g.accountId}:${normalizeCurrency(g.currencyCode)}`;
    const existing = openingMap.get(key) || { debit: 0, credit: 0 };
    existing.debit = round2(existing.debit + toNum(g._sum.debit));
    existing.credit = round2(existing.credit + toNum(g._sum.credit));
    openingMap.set(key, existing);
  }

  const periodMap = new Map<string, { debit: number; credit: number }>();
  for (const g of input.periodGroups) {
    const key = `${g.accountId}:${normalizeCurrency(g.currencyCode)}`;
    const existing = periodMap.get(key) || { debit: 0, credit: 0 };
    existing.debit = round2(existing.debit + toNum(g._sum.debit));
    existing.credit = round2(existing.credit + toNum(g._sum.credit));
    periodMap.set(key, existing);
  }

  // Hierarchy metadata: family follows the nearest recognized ancestor, which for a
  // parented account equals its parent's family (root families come from classifyAccount).
  const childrenOf = new Map<number, AccountInfo[]>();
  const roots: AccountInfo[] = [];
  for (const a of input.accounts) {
    if (a.parentId) {
      const siblings = childrenOf.get(a.parentId) || [];
      siblings.push(a);
      childrenOf.set(a.parentId, siblings);
    } else {
      roots.push(a);
    }
  }

  const familyById = new Map<number, AccountFamily>();
  const depthById = new Map<number, number>();
  const pathById = new Map<number, number[]>();
  const stack: Array<{ account: AccountInfo; depth: number; family: AccountFamily; path: number[] }> = roots.map(
    (account) => ({ account, depth: 0, family: classifyAccount(account.code), path: [account.id] }),
  );
  while (stack.length > 0) {
    const node = stack.pop()!;
    familyById.set(node.account.id, node.family);
    depthById.set(node.account.id, node.depth);
    pathById.set(node.account.id, node.path);
    for (const kid of childrenOf.get(node.account.id) || []) {
      stack.push({ account: kid, depth: node.depth + 1, family: node.family, path: [...node.path, kid.id] });
    }
  }

  // Row keys: every direct journal key plus the same-currency key for each ancestor.
  const directKeys = new Set<string>([...openingMap.keys(), ...periodMap.keys()]);
  const expandedKeys = new Set<string>();
  for (const key of directKeys) {
    const [accountIdStr, currencyCode] = key.split(":");
    let account = accountMap.get(Number(accountIdStr));
    while (account) {
      expandedKeys.add(`${account.id}:${currencyCode}`);
      account = account.parentId ? accountMap.get(account.parentId) : undefined;
    }
  }

  const makeValues = (opening: { debit: number; credit: number }, period: { debit: number; credit: number }) => {
    const openingNet = round2(opening.debit - opening.credit);
    const closingNet = round2(openingNet + period.debit - period.credit);
    return {
      openingDebit: openingNet > 0 ? round2(openingNet) : 0,
      openingCredit: openingNet < 0 ? round2(Math.abs(openingNet)) : 0,
      periodDebit: round2(period.debit),
      periodCredit: round2(period.credit),
      closingDebit: closingNet > 0 ? round2(closingNet) : 0,
      closingCredit: closingNet < 0 ? round2(Math.abs(closingNet)) : 0,
    };
  };

  // Recursive subtree aggregation (hierarchy is validated acyclic above).
  const subtreeMemo = new Map<string, { openingDebit: number; openingCredit: number; periodDebit: number; periodCredit: number }>();
  const subtreeOf = (accountId: number, currencyCode: string) => {
    const key = `${accountId}:${currencyCode}`;
    const memo = subtreeMemo.get(key);
    if (memo) return memo;
    const opening = openingMap.get(key) || { debit: 0, credit: 0 };
    const period = periodMap.get(key) || { debit: 0, credit: 0 };
    const total = { openingDebit: opening.debit, openingCredit: opening.credit, periodDebit: period.debit, periodCredit: period.credit };
    for (const kid of childrenOf.get(accountId) || []) {
      const childTotal = subtreeOf(kid.id, currencyCode);
      total.openingDebit += childTotal.openingDebit;
      total.openingCredit += childTotal.openingCredit;
      total.periodDebit += childTotal.periodDebit;
      total.periodCredit += childTotal.periodCredit;
    }
    for (const field of ["openingDebit", "openingCredit", "periodDebit", "periodCredit"] as const) {
      total[field] = round2(total[field]);
    }
    subtreeMemo.set(key, total);
    return total;
  };

  const sortedKeys = [...expandedKeys].sort((ka, kb) => {
    const [aId, aCur] = ka.split(":");
    const [bId, bCur] = kb.split(":");
    const pathA = pathById.get(Number(aId)) || [Number(aId)];
    const pathB = pathById.get(Number(bId)) || [Number(bId)];
    const len = Math.min(pathA.length, pathB.length);
    for (let i = 0; i < len; i++) {
      if (pathA[i] !== pathB[i]) return pathA[i] - pathB[i];
    }
    if (pathA.length !== pathB.length) return pathA.length - pathB.length;
    return aCur.localeCompare(bCur);
  });

  const rows: TrialBalanceRow[] = [];
  for (const key of sortedKeys) {
    const [accountIdStr, currencyCode] = key.split(":");
    const accountId = Number(accountIdStr);
    const acc = accountMap.get(accountId);
    if (!acc) continue;

    const ownOpening = openingMap.get(key) || { debit: 0, credit: 0 };
    const ownPeriod = periodMap.get(key) || { debit: 0, credit: 0 };
    const direct = makeValues(ownOpening, ownPeriod);

    const subtree = subtreeOf(accountId, currencyCode);
    const displayed = makeValues(
      { debit: subtree.openingDebit, credit: subtree.openingCredit },
      { debit: subtree.periodDebit, credit: subtree.periodCredit },
    );

    const family = familyById.get(acc.id) ?? classifyAccount(acc.code);
    const familyDef = getFamilyDef(family);

    rows.push({
      accountId: acc.id,
      accountCode: acc.code,
      accountName: acc.name,
      accountType: acc.accountType,
      family,
      familyLabel: familyDef.label,
      currencyCode,
      ...displayed,
      depth: depthById.get(acc.id) ?? 0,
      parentId: acc.parentId ?? null,
      isParentRow: (childrenOf.get(acc.id) || []).length > 0,
      hasDirectEntries: acc.hasDirectEntries ?? (openingMap.has(key) || periodMap.has(key)),
      direct,
    });
  }

  const grouped = new Map<string, { family: AccountFamily; accountType: string; rows: TrialBalanceRow[] }>();
  for (const row of rows) {
    const gkey = `${row.family}:${row.currencyCode}`;
    if (!grouped.has(gkey)) {
      grouped.set(gkey, { family: row.family, accountType: row.accountType, rows: [] });
    }
    grouped.get(gkey)!.rows.push(row);
  }

  const sectionMap = new Map<string, { accountType: string; groups: Map<string, TrialBalanceGroup> }>();
  for (const [, g] of grouped) {
    const familyDef = getFamilyDef(g.family);
    if (!sectionMap.has(g.accountType)) {
      sectionMap.set(g.accountType, { accountType: g.accountType, groups: new Map() });
    }
    const section = sectionMap.get(g.accountType)!;
    if (!section.groups.has(g.family)) {
      section.groups.set(g.family, {
        family: g.family,
        familyLabel: familyDef.label,
        accountType: g.accountType,
        sortOrder: familyDef.sortOrder,
        rows: [],
        totals: {},
      });
    }
    const group = section.groups.get(g.family)!;
    group.rows.push(...g.rows);
    for (const row of g.rows) {
      // Totals use direct values only: parent rows display recursive balances,
      // and every journal entry must be counted exactly once.
      addCurrencyTotals(group.totals, row.currencyCode, row.direct);
    }
  }

  const sections: TrialBalanceSection[] = [];
  for (const [, s] of sectionMap) {
    const groups = [...s.groups.values()].sort((a, b) => a.sortOrder - b.sortOrder);
    sections.push({
      accountType: s.accountType,
      label: ACCOUNT_TYPE_LABELS[s.accountType] || s.accountType,
      sortOrder: ACCOUNT_TYPE_ORDER[s.accountType] || 99,
      groups,
    });
  }
  sections.sort((a, b) => a.sortOrder - b.sortOrder);

  const currencyTotals: CurrencyTotals = {};
  for (const section of sections) {
    for (const group of section.groups) {
      for (const [currency, totals] of Object.entries(group.totals)) {
        addCurrencyTotals(currencyTotals, currency, totals);
      }
    }
  }

  const reconciliation = Object.entries(currencyTotals).map(([currency, totals]) => {
    const openingDiff = round2(totals.openingDebit - totals.openingCredit);
    const periodDiff = round2(totals.periodDebit - totals.periodCredit);
    const closingDiff = round2(totals.closingDebit - totals.closingCredit);
    return {
      currency,
      openingDiff,
      periodDiff,
      closingDiff,
      balanced: Math.abs(openingDiff) < 0.01 && Math.abs(periodDiff) < 0.01 && Math.abs(closingDiff) < 0.01,
    };
  });

  const allBalanced = reconciliation.every((r) => r.balanced);

  return { sections, currencyTotals, reconciliation, allBalanced };
}

export function filterTrialBalanceRows(
  result: TrialBalanceResult,
  filters: { search?: string; accountType?: string; currency?: string },
): TrialBalanceResult {
  const search = (filters.search || "").toLowerCase().trim();
  const accountType = (filters.accountType || "").trim();
  const currency = (filters.currency || "").trim().toUpperCase();

  const filteredSections: TrialBalanceSection[] = [];
  for (const section of result.sections) {
    if (accountType && section.accountType !== accountType) continue;
    const filteredGroups: TrialBalanceGroup[] = [];
    for (const group of section.groups) {
      let rows = group.rows;
      if (currency) rows = rows.filter((r) => r.currencyCode === currency);
      if (search) {
        rows = rows.filter(
          (r) =>
            r.accountCode.toLowerCase().includes(search) ||
            r.accountName.toLowerCase().includes(search) ||
            r.familyLabel.toLowerCase().includes(search),
        );
      }
      if (rows.length === 0) continue;
      const totals: CurrencyTotals = {};
      for (const row of rows) {
        addCurrencyTotals(totals, row.currencyCode, row.direct);
      }
      filteredGroups.push({ ...group, rows, totals });
    }
    if (filteredGroups.length === 0) continue;
    filteredSections.push({ ...section, groups: filteredGroups });
  }

  const currencyTotals: CurrencyTotals = {};
  for (const section of filteredSections) {
    for (const group of section.groups) {
      for (const [curr, totals] of Object.entries(group.totals)) {
        addCurrencyTotals(currencyTotals, curr, totals);
      }
    }
  }

  const reconciliation = Object.entries(currencyTotals).map(([curr, totals]) => ({
    currency: curr,
    openingDiff: round2(totals.openingDebit - totals.openingCredit),
    periodDiff: round2(totals.periodDebit - totals.periodCredit),
    closingDiff: round2(totals.closingDebit - totals.closingCredit),
    balanced:
      Math.abs(round2(totals.openingDebit - totals.openingCredit)) < 0.01 &&
      Math.abs(round2(totals.periodDebit - totals.periodCredit)) < 0.01 &&
      Math.abs(round2(totals.closingDebit - totals.closingCredit)) < 0.01,
  }));

  return { sections: filteredSections, currencyTotals, reconciliation, allBalanced: reconciliation.every((r) => r.balanced) };
}

export { round2, normalizeCurrency };

// Search and account-type filters produce account subsets whose D/C imbalance is
// expected; only unfiltered (or full single-currency / scoped) views may assert
// reconciliation. Shared by the Trial Balance API and the XLSX export.
export function reconciliationIsMeaningful(filters: {
  search?: string | null;
  accountType?: string | null;
}): boolean {
  return !(filters.search || filters.accountType);
}
