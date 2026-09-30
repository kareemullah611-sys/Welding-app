import prisma from "@/lib/prisma";
import { buildDateRange } from "@/lib/date-range";
import {
  normalizeCurrency,
  validateAccountHierarchy,
  type AccountInfo,
  type JournalGroupEntry,
} from "@/lib/trial-balance";

const ACCOUNT_SELECT = {
  id: true,
  code: true,
  name: true,
  accountType: true,
  cityId: true,
  parentId: true,
} as const;

type DbAccount = {
  id: number;
  code: string;
  name: string;
  accountType: string;
  cityId: number | null;
  parentId: number | null;
};

export type TrialBalanceSource = {
  accounts: AccountInfo[];
  relevantAccountIds: number[];
  openingGroups: JournalGroupEntry[];
  periodGroups: JournalGroupEntry[];
};

// Loads the account hierarchy (active OR journal-bearing accounts plus their full
// ancestor closure), validates it, and aggregates journal totals for the period.
export async function loadTrialBalanceSource(params: {
  dateFrom: string;
  dateTo: string;
  cityId?: number;
  currencyParam?: string | null;
}): Promise<TrialBalanceSource> {
  const range = buildDateRange(params.dateFrom, params.dateTo);

  const baseAccounts: DbAccount[] = await prisma.account.findMany({
    where: { OR: [{ isActive: true }, { journalEntries: { some: {} } }] },
    select: ACCOUNT_SELECT,
  });

  const byId = new Map<number, DbAccount>(baseAccounts.map((a) => [a.id, a]));
  const collectMissing = (): number[] => {
    const missing = new Set<number>();
    for (const a of byId.values()) {
      if (a.parentId && !byId.has(a.parentId)) missing.add(a.parentId);
    }
    return [...missing];
  };
  let missing = collectMissing();
  while (missing.length > 0) {
    const fetched: DbAccount[] = await prisma.account.findMany({ where: { id: { in: missing } }, select: ACCOUNT_SELECT });
    if (fetched.length === 0) break; // truly missing parents — validation rejects below
    for (const a of fetched) byId.set(a.id, a);
    missing = collectMissing();
  }

  const closure = [...byId.values()];
  validateAccountHierarchy(closure);

  const journalGroups = await prisma.journalEntry.groupBy({
    by: ["accountId"],
    where: { accountId: { in: closure.map((a) => a.id) } },
  });
  const directIds = new Set(journalGroups.map((g) => g.accountId));

  const relevant = params.cityId ? closure.filter((a) => !a.cityId || a.cityId === params.cityId) : closure;
  const accountIds = relevant.map((a) => a.id);

  const accounts: AccountInfo[] = closure.map((a) => ({ ...a, hasDirectEntries: directIds.has(a.id) }));

  if (accountIds.length === 0) {
    return { accounts, relevantAccountIds: [], openingGroups: [], periodGroups: [] };
  }

  let currencyWhere: Record<string, unknown> | undefined;
  if (params.currencyParam) {
    const normalized = normalizeCurrency(params.currencyParam);
    currencyWhere = normalized === "CNY" ? { currencyCode: { in: ["CNY", "RMB"] } } : { currencyCode: normalized };
  }
  const cityFilter = params.cityId ? { cityId: params.cityId } : {};

  const [openingGroups, periodGroups] = await Promise.all([
    prisma.journalEntry.groupBy({
      by: ["accountId", "currencyCode"],
      where: {
        accountId: { in: accountIds },
        entryDate: { lt: range.gte },
        ...cityFilter,
        ...(currencyWhere || {}),
      },
      _sum: { debit: true, credit: true },
    }),
    prisma.journalEntry.groupBy({
      by: ["accountId", "currencyCode"],
      where: {
        accountId: { in: accountIds },
        entryDate: { gte: range.gte, lt: range.lt },
        ...cityFilter,
        ...(currencyWhere || {}),
      },
      _sum: { debit: true, credit: true },
    }),
  ]);

  return { accounts, relevantAccountIds: accountIds, openingGroups, periodGroups };
}
