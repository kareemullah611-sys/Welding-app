import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import { buildTrialBalance, type AccountInfo, type JournalGroupEntry } from "./trial-balance";

function acc(id: number, code: string, opts: { type?: string; parentId?: number | null; hasDirect?: boolean } = {}): AccountInfo {
  return {
    id,
    code,
    name: `Name ${code}`,
    accountType: opts.type || "asset",
    parentId: opts.parentId ?? null,
    hasDirectEntries: opts.hasDirect,
  };
}

function g(accountId: number, debit: number, credit = 0, currencyCode = "PKR"): JournalGroupEntry {
  return { accountId, currencyCode, _sum: { debit, credit } };
}

function findRow(result: ReturnType<typeof buildTrialBalance>, code: string, currency = "PKR") {
  for (const section of result.sections) {
    for (const group of section.groups) {
      const row = group.rows.find((r) => r.accountCode === code && r.currencyCode === currency);
      if (row) return row;
    }
  }
  return undefined;
}

function expectHierarchyRejection(fn: () => unknown, pattern: RegExp) {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught, "expected hierarchy validation to throw");
  const e = caught as { name?: string; message?: string };
  assert.equal(e.name, "AccountHierarchyError");
  assert.match(String(e.message), pattern);
}

test("P2: family classification follows the nearest recognized ancestor across multiple levels", () => {
  const result = buildTrialBalance({
    accounts: [
      acc(1, "1050-BANK-P2"),
      acc(2, "P2-MID-UNMAPPED", { parentId: 1 }),
      acc(3, "P2-LEAF-UNMAPPED", { parentId: 2 }),
    ],
    openingGroups: [],
    periodGroups: [g(3, 50)],
  });

  const leaf = findRow(result, "P2-LEAF-UNMAPPED");
  const mid = findRow(result, "P2-MID-UNMAPPED");
  const root = findRow(result, "1050-BANK-P2");
  assert.ok(leaf, "leaf row must exist");
  assert.ok(mid, "mid-level ancestor row must exist");
  assert.ok(root, "root ancestor row must exist");
  assert.equal(leaf.family, "bank", "leaf family comes from nearest recognized ancestor");
  assert.equal(mid.family, "bank");
  assert.equal(root.family, "bank");
  assert.equal(leaf.depth, 2);
  assert.equal(mid.depth, 1);
  assert.equal(root.depth, 0);
});

test("P2: parent rows display recursive totals while group/currency totals count each journal exactly once", () => {
  const result = buildTrialBalance({
    accounts: [acc(1, "P2-PARENT-A", { hasDirect: true }), acc(2, "P2-CHILD-A", { parentId: 1, hasDirect: true })],
    openingGroups: [],
    periodGroups: [g(1, 100), g(2, 50)],
  });

  const parent = findRow(result, "P2-PARENT-A");
  const child = findRow(result, "P2-CHILD-A");
  assert.ok(parent && child, "both parent and child rows must exist");
  assert.equal(parent.closingDebit, 150, "parent displays direct + descendant balance");
  assert.equal(child.closingDebit, 50);
  assert.equal(parent.direct.closingDebit, 100, "direct totals retained separately");
  assert.equal(parent.isParentRow, true);
  assert.equal(parent.parentId, null);
  assert.equal(child.parentId, 1);
  assert.equal(child.depth, 1);

  const totals = result.currencyTotals.PKR;
  assert.ok(totals, "PKR totals required");
  assert.equal(totals.closingDebit, 150, "totals must not double-count parent rows");
  assert.equal(totals.periodDebit, 150);
});

test("P2: presentation-only parent (no direct journals) still gets a row with recursive values", () => {
  const result = buildTrialBalance({
    accounts: [acc(1, "P2-PARENT-NOJ", { hasDirect: false }), acc(2, "P2-CHILD-NOJ", { parentId: 1, hasDirect: true })],
    openingGroups: [],
    periodGroups: [g(2, 50)],
  });

  const parent = findRow(result, "P2-PARENT-NOJ");
  const child = findRow(result, "P2-CHILD-NOJ");
  assert.ok(parent, "presentation-only parent row must exist");
  assert.ok(child, "child row must exist");
  assert.equal(parent.closingDebit, 50);
  assert.equal(parent.direct.closingDebit, 0);
  assert.equal(parent.isParentRow, true);
  assert.equal(parent.hasDirectEntries, false, "presentation-only parent must be non-clickable");
  assert.equal(child.hasDirectEntries, true);
  assert.equal(result.currencyTotals.PKR.closingDebit, 50);
});

test("P2: arbitrary hierarchy depth aggregates recursively with pre-order rows", () => {
  const accounts: AccountInfo[] = [];
  for (let i = 1; i <= 12; i++) {
    accounts.push(acc(i, `P2-DEEP-${i}`, { parentId: i === 1 ? null : i - 1, hasDirect: i === 12 }));
  }
  const result = buildTrialBalance({ accounts, openingGroups: [], periodGroups: [g(12, 77)] });

  const ordered: number[] = [];
  for (const section of result.sections) {
    for (const group of section.groups) {
      for (const row of group.rows) ordered.push(row.accountId);
    }
  }
  assert.equal(ordered.length, 12, "every ancestor on the chain must render a row");
  assert.deepEqual(ordered, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], "rows must be pre-order, parent before children");
  assert.equal(findRow(result, "P2-DEEP-1")!.depth, 0);
  assert.equal(findRow(result, "P2-DEEP-12")!.depth, 11);
  assert.equal(findRow(result, "P2-DEEP-1")!.closingDebit, 77, "root displays recursive total");
  assert.equal(findRow(result, "P2-DEEP-12")!.closingDebit, 77);
  assert.equal(result.currencyTotals.PKR.closingDebit, 77, "each journal counted once");
});

test("P2: validation rejects self-parenting, missing parents, cycles, and cross-account-type parenting", () => {
  expectHierarchyRejection(
    () => buildTrialBalance({ accounts: [acc(1, "P2-SELF", { parentId: 1 })], openingGroups: [], periodGroups: [] }),
    /own parent/i,
  );
  expectHierarchyRejection(
    () => buildTrialBalance({ accounts: [acc(1, "P2-MISSING", { parentId: 999999 })], openingGroups: [], periodGroups: [] }),
    /missing parent/i,
  );
  expectHierarchyRejection(
    () =>
      buildTrialBalance({
        accounts: [acc(1, "P2-CYC-A", { parentId: 2 }), acc(2, "P2-CYC-B", { parentId: 1 })],
        openingGroups: [],
        periodGroups: [],
      }),
    /cycle/i,
  );
  expectHierarchyRejection(
    () =>
      buildTrialBalance({
        accounts: [acc(1, "P2-TYPE-P", { type: "liability" }), acc(2, "P2-TYPE-C", { parentId: 1, type: "asset" })],
        openingGroups: [],
        periodGroups: [],
      }),
    /accountType mismatch/i,
  );
});

test("P2: hasDirectEntries falls back to scope evidence when not provided", () => {
  const result = buildTrialBalance({
    accounts: [acc(1, "P2-FALLBACK-P"), acc(2, "P2-FALLBACK-C", { parentId: 1 })],
    openingGroups: [g(1, 10)],
    periodGroups: [g(2, 20)],
  });
  const parent = findRow(result, "P2-FALLBACK-P");
  const child = findRow(result, "P2-FALLBACK-C");
  assert.ok(parent && child);
  assert.equal(parent.hasDirectEntries, true, "parent has direct journals in scope");
  assert.equal(child.hasDirectEntries, true);
});

test("P2 UI: Trial Balance rows gate clicks on hasDirectEntries, indent by depth, and expose expand toggles", () => {
  const src = fs.readFileSync("src/app/(dashboard)/trial-balance/page.tsx", "utf8");
  assert.match(src, /hasDirectEntries/, "row click must be gated on direct journal availability");
  assert.match(src, /onClick=\{row\.hasDirectEntries\s*\?/, "presentation-only rows must not be clickable");
  assert.match(src, /row\.depth/, "rows must be indented by hierarchy depth");
  assert.match(src, /aria-expanded/, "expand/collapse toggles must expose aria-expanded");
});

test("P2 UI: account ledger labels direct-only view when the account has descendants", () => {
  const src = fs.readFileSync("src/app/(dashboard)/accounts/ledger/page.tsx", "utf8");
  assert.match(src, /descendantCount/, "ledger must surface descendant count for parent accounts");
  assert.match(src, /[Dd]irect entries only/, "ledger must state that descendant activity is excluded");
});
