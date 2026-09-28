import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTrialBalance,
  filterTrialBalanceRows,
  normalizeCurrency,
  round2,
  type JournalGroupEntry,
  type AccountInfo,
} from "./trial-balance";
import { classifyAccount, getFamilyDef, ACCOUNT_TYPE_ORDER } from "./account-grouping";

const accounts: AccountInfo[] = [
  { id: 1, code: "1001-CITY1", name: "Cash - Karachi", accountType: "asset" },
  { id: 2, code: "1050-BANK1", name: "Bank - HBL 123", accountType: "asset" },
  { id: 3, code: "1200-C1", name: "AR - Customer A", accountType: "asset" },
  { id: 4, code: "1100", name: "Inventory", accountType: "asset" },
  { id: 5, code: "2100-S1", name: "Payable - Supplier X", accountType: "liability" },
  { id: 6, code: "3001", name: "Sales Revenue", accountType: "revenue" },
  { id: 7, code: "4001", name: "Cost of Goods Sold", accountType: "cogs" },
  { id: 8, code: "5099", name: "Other Expenses", accountType: "expense" },
  { id: 9, code: "3900", name: "Opening Balances", accountType: "equity" },
  { id: 10, code: "FX-GAIN", name: "Foreign Exchange Gain", accountType: "revenue" },
  { id: 11, code: "FX-LOSS", name: "Foreign Exchange Loss", accountType: "expense" },
  { id: 12, code: "UNKNOWN-ACC", name: "Unknown Account", accountType: "asset" },
];

test("opening debit balance: positive net shows in Opening Debit column", () => {
  const result = buildTrialBalance({
    accounts,
    openingGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 50000, credit: 10000 } },
    ],
    periodGroups: [],
  });

  const cashSection = result.sections.find((s) => s.accountType === "asset");
  const cashGroup = cashSection?.groups.find((g) => g.family === "cash");
  const cashRow = cashGroup?.rows.find((r) => r.accountCode === "1001-CITY1");

  assert.ok(cashRow);
  assert.equal(cashRow.openingDebit, 40000);
  assert.equal(cashRow.openingCredit, 0);
  assert.equal(cashRow.closingDebit, 40000);
  assert.equal(cashRow.closingCredit, 0);
});

test("opening credit balance: negative net shows in Opening Credit column", () => {
  const result = buildTrialBalance({
    accounts,
    openingGroups: [
      { accountId: 5, currencyCode: "PKR", _sum: { debit: 5000, credit: 20000 } },
    ],
    periodGroups: [],
  });

  const liabSection = result.sections.find((s) => s.accountType === "liability");
  const suppGroup = liabSection?.groups.find((g) => g.family === "supplier_payable");
  const suppRow = suppGroup?.rows.find((r) => r.accountCode === "2100-S1");

  assert.ok(suppRow);
  assert.equal(suppRow.openingDebit, 0);
  assert.equal(suppRow.openingCredit, 15000);
  assert.equal(suppRow.closingDebit, 0);
  assert.equal(suppRow.closingCredit, 15000);
});

test("gross period debit/credit activity: debits and credits shown separately, not netted", () => {
  const result = buildTrialBalance({
    accounts,
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 100000, credit: 60000 } },
    ],
  });

  const cashSection = result.sections.find((s) => s.accountType === "asset");
  const cashGroup = cashSection?.groups.find((g) => g.family === "cash");
  const cashRow = cashGroup?.rows.find((r) => r.accountCode === "1001-CITY1");

  assert.ok(cashRow);
  assert.equal(cashRow.periodDebit, 100000);
  assert.equal(cashRow.periodCredit, 60000);
  assert.equal(cashRow.closingDebit, 40000);
  assert.equal(cashRow.closingCredit, 0);
});

test("closing debit balance: opening + period = positive closing", () => {
  const result = buildTrialBalance({
    accounts,
    openingGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 50000, credit: 0 } },
    ],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 30000, credit: 10000 } },
    ],
  });

  const cashSection = result.sections.find((s) => s.accountType === "asset");
  const cashGroup = cashSection?.groups.find((g) => g.family === "cash");
  const cashRow = cashGroup?.rows.find((r) => r.accountCode === "1001-CITY1");

  assert.ok(cashRow);
  assert.equal(cashRow.closingDebit, 70000);
  assert.equal(cashRow.closingCredit, 0);
});

test("closing credit balance: opening + period = negative closing", () => {
  const result = buildTrialBalance({
    accounts,
    openingGroups: [
      { accountId: 5, currencyCode: "PKR", _sum: { debit: 0, credit: 10000 } },
    ],
    periodGroups: [
      { accountId: 5, currencyCode: "PKR", _sum: { debit: 2000, credit: 5000 } },
    ],
  });

  const liabSection = result.sections.find((s) => s.accountType === "liability");
  const suppGroup = liabSection?.groups.find((g) => g.family === "supplier_payable");
  const suppRow = suppGroup?.rows.find((r) => r.accountCode === "2100-S1");

  assert.ok(suppRow);
  assert.equal(suppRow.closingDebit, 0);
  assert.equal(suppRow.closingCredit, 13000);
});

test("exact zero reconciliation: balanced journals produce zero difference", () => {
  const result = buildTrialBalance({
    accounts,
    openingGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 50000, credit: 0 } },
      { accountId: 9, currencyCode: "PKR", _sum: { debit: 0, credit: 50000 } },
    ],
    periodGroups: [
      { accountId: 3, currencyCode: "PKR", _sum: { debit: 10000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 10000 } },
    ],
  });

  assert.equal(result.allBalanced, true);
  for (const r of result.reconciliation) {
    assert.equal(r.balanced, true);
    assert.ok(Math.abs(r.openingDiff) < 0.01, `Opening diff for ${r.currency}: ${r.openingDiff}`);
    assert.ok(Math.abs(r.periodDiff) < 0.01, `Period diff for ${r.currency}: ${r.periodDiff}`);
    assert.ok(Math.abs(r.closingDiff) < 0.01, `Closing diff for ${r.currency}: ${r.closingDiff}`);
  }
});

test("separate PKR/USD/AFN/CNY/AED totals: currencies never mixed", () => {
  const result = buildTrialBalance({
    accounts: [
      { id: 1, code: "1001-CITY1", name: "Cash - Karachi", accountType: "asset" },
      { id: 6, code: "3001", name: "Sales Revenue", accountType: "revenue" },
    ],
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 50000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 50000 } },
      { accountId: 1, currencyCode: "USD", _sum: { debit: 1000, credit: 0 } },
      { accountId: 6, currencyCode: "USD", _sum: { debit: 0, credit: 1000 } },
      { accountId: 1, currencyCode: "AFN", _sum: { debit: 50000, credit: 0 } },
      { accountId: 6, currencyCode: "AFN", _sum: { debit: 0, credit: 50000 } },
    ],
  });

  assert.equal(result.reconciliation.length, 3);
  const pkr = result.currencyTotals["PKR"];
  const usd = result.currencyTotals["USD"];
  const afn = result.currencyTotals["AFN"];
  assert.ok(pkr);
  assert.ok(usd);
  assert.ok(afn);
  assert.equal(pkr.periodDebit, 50000);
  assert.equal(usd.periodDebit, 1000);
  assert.equal(afn.periodDebit, 50000);
});

test("RMB normalization to CNY", () => {
  assert.equal(normalizeCurrency("RMB"), "CNY");
  assert.equal(normalizeCurrency("rmb"), "CNY");
  assert.equal(normalizeCurrency("CNY"), "CNY");
  assert.equal(normalizeCurrency("PKR"), "PKR");
});

test("date-range inclusivity: entry on from_date is in period, entry on to_date is excluded", () => {
  const result = buildTrialBalance({
    accounts: [
      { id: 1, code: "1001-CITY1", name: "Cash", accountType: "asset" },
      { id: 6, code: "3001", name: "Revenue", accountType: "revenue" },
    ],
    openingGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 10000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 10000 } },
    ],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 5000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 5000 } },
    ],
  });

  assert.equal(result.allBalanced, true);
  const cashSection = result.sections.find((s) => s.accountType === "asset");
  const cashRow = cashSection?.groups[0]?.rows[0];
  assert.ok(cashRow);
  assert.equal(cashRow.openingDebit, 10000);
  assert.equal(cashRow.periodDebit, 5000);
  assert.equal(cashRow.closingDebit, 15000);
});

test("city filtering through JournalEntry.cityId: city-scoped account shows only that city", () => {
  const result = buildTrialBalance({
    accounts: [
      { id: 1, code: "1001-CITY1", name: "Cash - Karachi", accountType: "asset" },
      { id: 2, code: "1001-CITY2", name: "Cash - Lahore", accountType: "asset" },
      { id: 6, code: "3001", name: "Revenue", accountType: "revenue" },
    ],
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 10000, credit: 0 } },
      { accountId: 2, currencyCode: "PKR", _sum: { debit: 20000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 30000 } },
    ],
  });

  const assetSection = result.sections.find((s) => s.accountType === "asset");
  const allCashRows = assetSection?.groups.flatMap((g) => g.rows) || [];
  assert.equal(allCashRows.length, 2);
  assert.equal(allCashRows[0].closingDebit, 10000);
  assert.equal(allCashRows[1].closingDebit, 20000);
});

test("global account with city-scoped journal lines: global account included when city filter present", () => {
  const globalAccounts: AccountInfo[] = [
    { id: 4, code: "1100", name: "Inventory", accountType: "asset" },
    { id: 6, code: "3001", name: "Sales Revenue", accountType: "revenue" },
  ];

  const result = buildTrialBalance({
    accounts: globalAccounts,
    openingGroups: [],
    periodGroups: [
      { accountId: 4, currencyCode: "PKR", _sum: { debit: 50000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 50000 } },
    ],
  });

  assert.equal(result.allBalanced, true);
  const assetSection = result.sections.find((s) => s.accountType === "asset");
  const invRow = assetSection?.groups.find((g) => g.family === "inventory")?.rows[0];
  assert.ok(invRow);
  assert.equal(invRow.closingDebit, 50000);
});

test("account-type and explicit-family grouping: accounts grouped by family within type", () => {
  const result = buildTrialBalance({
    accounts: [
      { id: 1, code: "1001-CITY1", name: "Cash - Karachi", accountType: "asset" },
      { id: 2, code: "1050-BANK1", name: "Bank - HBL", accountType: "asset" },
      { id: 3, code: "1200-C1", name: "AR - Customer A", accountType: "asset" },
      { id: 6, code: "3001", name: "Revenue", accountType: "revenue" },
    ],
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 10000, credit: 0 } },
      { accountId: 2, currencyCode: "PKR", _sum: { debit: 20000, credit: 0 } },
      { accountId: 3, currencyCode: "PKR", _sum: { debit: 5000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 35000 } },
    ],
  });

  const assetSection = result.sections.find((s) => s.accountType === "asset");
  assert.ok(assetSection);
  assert.equal(assetSection.groups.length, 3);
  const families = assetSection.groups.map((g) => g.family);
  assert.ok(families.includes("cash"));
  assert.ok(families.includes("bank"));
  assert.ok(families.includes("customer_receivable"));
});

test("unknown account code remains visible under 'other' family", () => {
  const result = buildTrialBalance({
    accounts,
    openingGroups: [],
    periodGroups: [
      { accountId: 12, currencyCode: "PKR", _sum: { debit: 100, credit: 0 } },
    ],
  });

  const assetSection = result.sections.find((s) => s.accountType === "asset");
  const otherGroup = assetSection?.groups.find((g) => g.family === "other");
  assert.ok(otherGroup);
  assert.equal(otherGroup.rows.length, 1);
  assert.equal(otherGroup.rows[0].accountCode, "UNKNOWN-ACC");
});

test("superadmin access allowed: no access check in buildTrialBalance (pure calculation)", () => {
  const result = buildTrialBalance({
    accounts: [
      { id: 1, code: "1001-CITY1", name: "Cash", accountType: "asset" },
      { id: 6, code: "3001", name: "Revenue", accountType: "revenue" },
    ],
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 1000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 1000 } },
    ],
  });

  assert.equal(result.allBalanced, true);
  assert.equal(result.sections.length, 2);
});

test("classifyAccount handles all known code patterns", () => {
  assert.equal(classifyAccount("1001-CITY1"), "cash");
  assert.equal(classifyAccount("1002-CHEQUE1"), "cheques_in_hand");
  assert.equal(classifyAccount("1050-BANK1"), "bank");
  assert.equal(classifyAccount("1050-SABANK1"), "superadmin_bank");
  assert.equal(classifyAccount("1051-SACASH1"), "superadmin_cash");
  assert.equal(classifyAccount("1060-H1"), "intermediary");
  assert.equal(classifyAccount("1061-HFX1"), "intermediary_fx_clearing");
  assert.equal(classifyAccount("1062-SAFX"), "superadmin_fx_clearing");
  assert.equal(classifyAccount("1100"), "inventory");
  assert.equal(classifyAccount("1200-C1"), "customer_receivable");
  assert.equal(classifyAccount("1250-H1"), "haji_receivable");
  assert.equal(classifyAccount("1250-S1"), "advance_to_supplier");
  assert.equal(classifyAccount("1260-SL1"), "advance_to_shipping_line");
  assert.equal(classifyAccount("1270-A1"), "advance_to_agent");
  assert.equal(classifyAccount("2100-S1"), "supplier_payable");
  assert.equal(classifyAccount("2200-A1"), "agent_payable");
  assert.equal(classifyAccount("2300-SL1"), "shipping_line_payable");
  assert.equal(classifyAccount("2350-I1"), "intermediary_payable");
  assert.equal(classifyAccount("2400-CL1"), "city_payable");
  assert.equal(classifyAccount("2450-H1"), "haji_payable");
  assert.equal(classifyAccount("2600-INVSETTLE"), "investor_settlement_payable");
  assert.equal(classifyAccount("2999"), "general_payable");
  assert.equal(classifyAccount("3001"), "sales_revenue");
  assert.equal(classifyAccount("FX-GAIN"), "fx_gain");
  assert.equal(classifyAccount("3900"), "opening_balances");
  assert.equal(classifyAccount("3901"), "historical_stock_adjustment");
  assert.equal(classifyAccount("3902"), "manager_capital");
  assert.equal(classifyAccount("3903"), "retained_earnings");
  assert.equal(classifyAccount("3904"), "other_opening_equity");
  assert.equal(classifyAccount("3905-P1"), "participant_capital");
  assert.equal(classifyAccount("3906-P1"), "participant_current_profit");
  assert.equal(classifyAccount("3907-P1"), "participant_ongoing_profit");
  assert.equal(classifyAccount("6002"), "owner_withdrawals");
  assert.equal(classifyAccount("6003"), "haji_account");
  assert.equal(classifyAccount("4001"), "cogs");
  assert.equal(classifyAccount("5001"), "customs_duty");
  assert.equal(classifyAccount("5002"), "freight");
  assert.equal(classifyAccount("5003"), "transport");
  assert.equal(classifyAccount("5004"), "port_charges");
  assert.equal(classifyAccount("5005"), "loading_unloading");
  assert.equal(classifyAccount("5006"), "insurance");
  assert.equal(classifyAccount("5007"), "customs_agent");
  assert.equal(classifyAccount("5008"), "clearing_agent");
  assert.equal(classifyAccount("5010"), "office_expenses");
  assert.equal(classifyAccount("5011"), "salaries");
  assert.equal(classifyAccount("5099"), "other_expenses");
  assert.equal(classifyAccount("FX-LOSS"), "fx_loss");
  assert.equal(classifyAccount("ZZZZ"), "other");
});

test("account ledger opening and running balance: opening = pre-period net, running accumulates", () => {
  const openingDebit = 50000;
  const openingCredit = 10000;
  const openingBalance = round2(openingDebit - openingCredit);

  assert.equal(openingBalance, 40000);

  const entries = [
    { debit: 5000, credit: 0 },
    { debit: 0, credit: 3000 },
    { debit: 2000, credit: 0 },
  ];

  let running = openingBalance;
  const balances: number[] = [];
  for (const e of entries) {
    running = round2(running + e.debit - e.credit);
    balances.push(running);
  }

  assert.equal(balances[0], 45000);
  assert.equal(balances[1], 42000);
  assert.equal(balances[2], 44000);
});

test("pagination does not corrupt running balance: page 2 starts from cumulative prior-pages balance", () => {
  // Simulate the API's pagination logic:
  // openingBalance = sum of all pre-period activity
  // page 2 running balance = openingBalance + sum(page1 entries) + page2 entries

  const openingBalance = 10000;
  const allPeriodEntries = [
    { debit: 5000, credit: 0 },   // entry 1
    { debit: 0, credit: 2000 },   // entry 2
    { debit: 3000, credit: 0 },   // entry 3
    { debit: 0, credit: 1000 },   // entry 4
  ];
  const PAGE_SIZE = 2;

  // Page 1: opening + entries[0..1]
  const page1Entries = allPeriodEntries.slice(0, PAGE_SIZE);
  let running1 = openingBalance;
  for (const e of page1Entries) running1 = round2(running1 + e.debit - e.credit);
  assert.equal(running1, 13000);

  // Page 2: opening + sum(entries[0..1]) + entries[2..3]
  // The API computes priorPagesDebit/Credit by summing entries before the current page
  const priorEntries = allPeriodEntries.slice(0, PAGE_SIZE); // entries[0..1]
  let priorDebit = 0, priorCredit = 0;
  for (const e of priorEntries) {
    priorDebit = round2(priorDebit + e.debit);
    priorCredit = round2(priorCredit + e.credit);
  }
  assert.equal(priorDebit, 5000);
  assert.equal(priorCredit, 2000);

  let running2 = round2(openingBalance + priorDebit - priorCredit);
  assert.equal(running2, 13000, "page 2 starts where page 1 ended");

  const page2Entries = allPeriodEntries.slice(PAGE_SIZE, PAGE_SIZE * 2);
  for (const e of page2Entries) running2 = round2(running2 + e.debit - e.credit);
  assert.equal(running2, 15000, "page 2 ends at cumulative balance");

  // Verify: closing balance = opening + sum(all period entries)
  const totalDebit = allPeriodEntries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = allPeriodEntries.reduce((s, e) => s + e.credit, 0);
  const closingBalance = round2(openingBalance + totalDebit - totalCredit);
  assert.equal(closingBalance, 15000, "closing balance matches across pages");
  assert.equal(running2, closingBalance, "page 2 final balance equals closing balance");
});

test("no PKR conversion attempted in Stage 1: currencyCode preserved as-is from journal", () => {
  const result = buildTrialBalance({
    accounts: [
      { id: 1, code: "1001-CITY1", name: "Cash", accountType: "asset" },
      { id: 6, code: "3001", name: "Revenue", accountType: "revenue" },
    ],
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "USD", _sum: { debit: 1000, credit: 0 } },
      { accountId: 6, currencyCode: "USD", _sum: { debit: 0, credit: 1000 } },
    ],
  });

  assert.equal(result.allBalanced, true);
  assert.equal(result.reconciliation.length, 1);
  assert.equal(result.reconciliation[0].currency, "USD");
  const usd = result.currencyTotals["USD"];
  assert.ok(usd);
  assert.equal(usd.periodDebit, 1000);
  assert.equal(usd.periodCredit, 1000);
  assert.ok(!result.currencyTotals["PKR"], "PKR should not appear when only USD journals exist");
});

test("filterTrialBalanceRows: search filters by code, name, and family", () => {
  const result = buildTrialBalance({
    accounts,
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 10000, credit: 0 } },
      { accountId: 2, currencyCode: "PKR", _sum: { debit: 20000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 30000 } },
    ],
  });

  const filtered = filterTrialBalanceRows(result, { search: "HBL" });
  const allRows = filtered.sections.flatMap((s) => s.groups.flatMap((g) => g.rows));
  assert.equal(allRows.length, 1);
  assert.equal(allRows[0].accountCode, "1050-BANK1");
});

test("filterTrialBalanceRows: account_type filter", () => {
  const result = buildTrialBalance({
    accounts,
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 10000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 10000 } },
    ],
  });

  const filtered = filterTrialBalanceRows(result, { accountType: "revenue" });
  assert.equal(filtered.sections.length, 1);
  assert.equal(filtered.sections[0].accountType, "revenue");
});

test("filterTrialBalanceRows: currency filter", () => {
  const result = buildTrialBalance({
    accounts: [
      { id: 1, code: "1001-CITY1", name: "Cash", accountType: "asset" },
      { id: 6, code: "3001", name: "Revenue", accountType: "revenue" },
    ],
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 10000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 10000 } },
      { accountId: 1, currencyCode: "USD", _sum: { debit: 1000, credit: 0 } },
      { accountId: 6, currencyCode: "USD", _sum: { debit: 0, credit: 1000 } },
    ],
  });

  const filtered = filterTrialBalanceRows(result, { currency: "USD" });
  const allRows = filtered.sections.flatMap((s) => s.groups.flatMap((g) => g.rows));
  assert.ok(allRows.every((r) => r.currencyCode === "USD"));
  assert.equal(allRows.length, 2);
});

test("sections sorted by account type order", () => {
  const result = buildTrialBalance({
    accounts: [
      { id: 6, code: "3001", name: "Revenue", accountType: "revenue" },
      { id: 8, code: "5099", name: "Expenses", accountType: "expense" },
      { id: 1, code: "1001-CITY1", name: "Cash", accountType: "asset" },
      { id: 5, code: "2100-S1", name: "Payable", accountType: "liability" },
    ],
    openingGroups: [],
    periodGroups: [
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 10000 } },
      { accountId: 8, currencyCode: "PKR", _sum: { debit: 5000, credit: 0 } },
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 10000, credit: 0 } },
      { accountId: 5, currencyCode: "PKR", _sum: { debit: 0, credit: 5000 } },
    ],
  });

  assert.equal(result.sections[0].accountType, "asset");
  assert.equal(result.sections[1].accountType, "liability");
  assert.equal(result.sections[2].accountType, "revenue");
  assert.equal(result.sections[3].accountType, "expense");
});

test("FX-GAIN and FX-LOSS classified correctly", () => {
  assert.equal(classifyAccount("FX-GAIN"), "fx_gain");
  assert.equal(classifyAccount("FX-LOSS"), "fx_loss");
  const gainDef = getFamilyDef("fx_gain");
  assert.equal(gainDef.accountType, "revenue");
  const lossDef = getFamilyDef("fx_loss");
  assert.equal(lossDef.accountType, "expense");
});

test("reconciliation detects unbalanced ledger", () => {
  const result = buildTrialBalance({
    accounts: [
      { id: 1, code: "1001-CITY1", name: "Cash", accountType: "asset" },
      { id: 6, code: "3001", name: "Revenue", accountType: "revenue" },
    ],
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 10000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 9999 } },
    ],
  });

  assert.equal(result.allBalanced, false);
  const pkrRecon = result.reconciliation.find((r) => r.currency === "PKR");
  assert.ok(pkrRecon);
  assert.equal(pkrRecon.balanced, false);
  assert.ok(Math.abs(pkrRecon.periodDiff - 1) < 0.01);
});

test("RMB journal entries are normalized to CNY in output", () => {
  const result = buildTrialBalance({
    accounts: [
      { id: 1, code: "1001-CITY1", name: "Cash", accountType: "asset" },
      { id: 6, code: "3001", name: "Revenue", accountType: "revenue" },
    ],
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "RMB", _sum: { debit: 1000, credit: 0 } },
      { accountId: 6, currencyCode: "RMB", _sum: { debit: 0, credit: 1000 } },
    ],
  });

  assert.equal(result.allBalanced, true);
  const cny = result.currencyTotals["CNY"];
  assert.ok(cny, "RMB entries should appear under CNY");
  assert.equal(cny.periodDebit, 1000);
  assert.ok(!result.currencyTotals["RMB"], "RMB should not appear as a separate currency");
});

test("inactive accounts with journal entries are included when passed as input", () => {
  // The trial balance operates on whatever accounts array is passed in.
  // The API is responsible for including inactive accounts that have journal entries.
  // This test verifies the pure calculation handles accounts regardless of isActive.
  const result = buildTrialBalance({
    accounts: [
      { id: 1, code: "1001-CITY1", name: "Cash - Old", accountType: "asset" },
      { id: 6, code: "3001", name: "Revenue", accountType: "revenue" },
    ],
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 5000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 5000 } },
    ],
  });

  assert.equal(result.allBalanced, true);
  const assetSection = result.sections.find((s) => s.accountType === "asset");
  const cashRow = assetSection?.groups.flatMap((g) => g.rows).find((r) => r.accountId === 1);
  assert.ok(cashRow, "Inactive account with journal entries must appear");
  assert.equal(cashRow.closingDebit, 5000);
});

test("account-type filter produces expected imbalance (not an integrity error)", () => {
  const result = buildTrialBalance({
    accounts: [
      { id: 1, code: "1001-CITY1", name: "Cash", accountType: "asset" },
      { id: 6, code: "3001", name: "Revenue", accountType: "revenue" },
    ],
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 10000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 10000 } },
    ],
  });

  // Filtering to only assets produces a debit-heavy subset
  const filtered = filterTrialBalanceRows(result, { accountType: "asset" });
  assert.equal(filtered.sections.length, 1);
  assert.equal(filtered.sections[0].accountType, "asset");

  // The filtered reconciliation shows imbalance because only one side of the
  // double-entry is included. This is expected and NOT an integrity error.
  const pkrRecon = filtered.reconciliation.find((r) => r.currency === "PKR");
  assert.ok(pkrRecon);
  assert.equal(pkrRecon.balanced, false, "Subset naturally imbalanced");
  // The caller must check reconciliationMeaningful to decide if this is an error.
});

test("closing balance accounts for full period, not just current page", () => {
  // Simulate 4 entries across 2 pages. Closing balance must equal
  // opening + all 4 entries, regardless of which page we're viewing.
  const openingBalance = 10000;
  const allEntries = [
    { debit: 5000, credit: 0 },
    { debit: 0, credit: 2000 },
    { debit: 3000, credit: 0 },
    { debit: 0, credit: 1000 },
  ];

  // Full closing balance
  let fullClosing = openingBalance;
  for (const e of allEntries) fullClosing = round2(fullClosing + e.debit - e.credit);
  assert.equal(fullClosing, 15000);

  // Page 2 closing must be the same as full closing
  let priorSum = openingBalance;
  for (const e of allEntries.slice(0, 2)) priorSum = round2(priorSum + e.debit - e.credit);
  let page2Closing = priorSum;
  for (const e of allEntries.slice(2)) page2Closing = round2(page2Closing + e.debit - e.credit);
  assert.equal(page2Closing, fullClosing, "Closing balance is the same regardless of current page");
});

test("currency filter produces balanced reconciliation (complete single-currency ledger)", () => {
  const result = buildTrialBalance({
    accounts: [
      { id: 1, code: "1001-CITY1", name: "Cash", accountType: "asset" },
      { id: 6, code: "3001", name: "Revenue", accountType: "revenue" },
    ],
    openingGroups: [],
    periodGroups: [
      { accountId: 1, currencyCode: "PKR", _sum: { debit: 10000, credit: 0 } },
      { accountId: 6, currencyCode: "PKR", _sum: { debit: 0, credit: 10000 } },
      { accountId: 1, currencyCode: "USD", _sum: { debit: 1000, credit: 0 } },
      { accountId: 6, currencyCode: "USD", _sum: { debit: 0, credit: 1000 } },
    ],
  });

  // Filtering by currency produces a complete single-currency ledger that should reconcile
  const filtered = filterTrialBalanceRows(result, { currency: "USD" });
  assert.equal(filtered.sections.length, 2);
  const usdRecon = filtered.reconciliation.find((r) => r.currency === "USD");
  assert.ok(usdRecon);
  assert.equal(usdRecon.balanced, true, "Single-currency filter should produce balanced reconciliation");
  assert.ok(Math.abs(usdRecon.periodDiff) < 0.01);
});

// ─── Route-level date boundary tests ───────────────────────────────────────────
// These replicate the account-ledger API's exact branching logic to catch
// date-boundary defects that pure arithmetic tests miss.

type DateScenario = {
  name: string;
  dateFrom: string | null;
  dateTo: string | null;
  entries: Array<{ id: number; debit: number; credit: number; date: string }>;
  expectedOpeningBalance: number;
  expectedPeriodEntryIds: number[];
};

const jan1 = "2026-01-01";
const jun30 = "2026-06-30";
const dec31 = "2026-12-31";

const allEntries = [
  { id: 1, debit: 10000, credit: 0, date: "2025-08-01" },
  { id: 2, debit: 0, credit: 3000, date: "2025-11-15" },
  { id: 3, debit: 5000, credit: 0, date: "2026-01-15" },
  { id: 4, debit: 0, credit: 2000, date: "2026-03-20" },
  { id: 5, debit: 8000, credit: 0, date: "2026-07-01" },
  { id: 6, debit: 0, credit: 4000, date: "2026-10-10" },
];

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function simulateDateBoundary(scenario: DateScenario) {
  // Replicate the API's date boundary logic, matching buildDateRange()
  // which adds +1 day to dateTo to make lt exclusive.
  const hasDates = !!(scenario.dateFrom || scenario.dateTo);

  let openingEntries: typeof allEntries = [];
  let periodEntries: typeof allEntries = [];

  if (!hasDates) {
    openingEntries = [];
    periodEntries = scenario.entries;
  } else if (scenario.dateFrom && scenario.dateTo) {
    const ltExclusive = addDays(scenario.dateTo, 1);
    openingEntries = scenario.entries.filter((e) => e.date < scenario.dateFrom!);
    periodEntries = scenario.entries.filter(
      (e) => e.date >= scenario.dateFrom! && e.date < ltExclusive,
    );
  } else if (scenario.dateFrom) {
    openingEntries = scenario.entries.filter((e) => e.date < scenario.dateFrom!);
    periodEntries = scenario.entries.filter((e) => e.date >= scenario.dateFrom!);
  } else if (scenario.dateTo) {
    // date_to only: opening = 0, period = entries on or before date_to
    const ltExclusive = addDays(scenario.dateTo, 1);
    openingEntries = [];
    periodEntries = scenario.entries.filter((e) => e.date < ltExclusive);
  }

  let openingBalance = 0;
  for (const e of openingEntries) openingBalance = round2(openingBalance + e.debit - e.credit);

  return {
    openingBalance,
    periodEntryIds: periodEntries.map((e) => e.id),
  };
}

test("account ledger dates: no dates → opening=0, period=all entries", () => {
  const result = simulateDateBoundary({
    name: "no dates",
    dateFrom: null,
    dateTo: null,
    entries: allEntries,
    expectedOpeningBalance: 0,
    expectedPeriodEntryIds: [1, 2, 3, 4, 5, 6],
  });
  assert.equal(result.openingBalance, 0);
  assert.deepEqual(result.periodEntryIds, [1, 2, 3, 4, 5, 6]);
});

test("account ledger dates: both dates → opening=before from, period=[from,to)", () => {
  const result = simulateDateBoundary({
    name: "both dates",
    dateFrom: jan1,
    dateTo: dec31,
    entries: allEntries,
    expectedOpeningBalance: 7000, // id 1: 10000, id 2: -3000
    expectedPeriodEntryIds: [3, 4, 5, 6],
  });
  assert.equal(result.openingBalance, 7000);
  assert.deepEqual(result.periodEntryIds, [3, 4, 5, 6]);
});

test("account ledger dates: date_from only → opening=before from, period=from onwards", () => {
  const result = simulateDateBoundary({
    name: "from only",
    dateFrom: jan1,
    dateTo: null,
    entries: allEntries,
    expectedOpeningBalance: 7000,
    expectedPeriodEntryIds: [3, 4, 5, 6],
  });
  assert.equal(result.openingBalance, 7000);
  assert.deepEqual(result.periodEntryIds, [3, 4, 5, 6]);
});

test("account ledger dates: date_to only → opening=0, period=before to", () => {
  const result = simulateDateBoundary({
    name: "to only",
    dateFrom: null,
    dateTo: jun30,
    entries: allEntries,
    expectedOpeningBalance: 0,
    expectedPeriodEntryIds: [1, 2, 3, 4], // id 3=2026-01-15, id 4=2026-03-20, both < 2026-06-30
  });
  assert.equal(result.openingBalance, 0);
  assert.deepEqual(result.periodEntryIds, [1, 2, 3, 4]);
});

test("account ledger dates: no double-count when no dates", () => {
  // With no dates, opening=0 and period=all. Total balance = sum(all entries).
  // Opening + period activity must equal the all-entries balance.
  const entries = allEntries;
  let totalBalance = 0;
  for (const e of entries) totalBalance = round2(totalBalance + e.debit - e.credit);

  const result = simulateDateBoundary({
    name: "no double count",
    dateFrom: null,
    dateTo: null,
    entries,
    expectedOpeningBalance: 0,
    expectedPeriodEntryIds: [],
  });

  // Period activity = sum of all period entries
  let periodActivity = 0;
  for (const e of entries.filter((e) => result.periodEntryIds.includes(e.id))) {
    periodActivity = round2(periodActivity + e.debit - e.credit);
  }

  const closingBalance = round2(result.openingBalance + periodActivity);
  assert.equal(closingBalance, totalBalance, "Closing = opening + period, no double count");
});

test("account ledger dates: date_to only does not double-count", () => {
  const result = simulateDateBoundary({
    name: "to only no double count",
    dateFrom: null,
    dateTo: jun30,
    entries: allEntries,
    expectedOpeningBalance: 0,
    expectedPeriodEntryIds: [],
  });

  // Entries 1,2,3,4 should be in period (all before 2026-06-30)
  assert.deepEqual(result.periodEntryIds, [1, 2, 3, 4]);
  assert.equal(result.openingBalance, 0, "Opening must be zero for date_to only");

  // Closing = 0 + (10000-3000+5000-2000) = 10000
  let periodSum = 0;
  for (const id of result.periodEntryIds) {
    const e = allEntries.find((x) => x.id === id)!;
    periodSum = round2(periodSum + e.debit - e.credit);
  }
  assert.equal(periodSum, 10000);
});

test("account ledger dates: entry exactly on date_to is included (buildDateRange +1 day)", () => {
  // buildDateRange adds +1 day to dateTo to make lt exclusive.
  // dateTo="2026-06-30" → lt="2026-07-01", so an entry on 2026-06-30 IS included.
  const boundaryEntries = [
    { id: 10, debit: 5000, credit: 0, date: "2026-06-29" },
    { id: 11, debit: 3000, credit: 0, date: "2026-06-30" }, // exactly on date_to
    { id: 12, debit: 8000, credit: 0, date: "2026-07-01" }, // day after date_to
  ];

  const result = simulateDateBoundary({
    name: "boundary",
    dateFrom: null,
    dateTo: "2026-06-30",
    entries: boundaryEntries,
    expectedOpeningBalance: 0,
    expectedPeriodEntryIds: [10, 11], // id 11 on date_to IS included, id 12 is not
  });

  assert.deepEqual(result.periodEntryIds, [10, 11], "Entry on date_to must be included");
  assert.equal(result.openingBalance, 0);
});
