import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeCustomerListSort,
  sortCustomersForDisplay,
} from "./customer-list-sort";

test("customer list sort accepts only approved options", () => {
  assert.equal(normalizeCustomerListSort("name_asc"), "name_asc");
  assert.equal(normalizeCustomerListSort("balance_desc"), "balance_desc");
  assert.equal(normalizeCustomerListSort("unexpected"), "newest");
});

test("balance sorting uses the selected currency without combining currencies", () => {
  const rows = [
    { id: 1, name: "Mixed", balanceByCurrency: { AFN: 100_000, USD: 500 } },
    { id: 2, name: "Dollar", balanceByCurrency: { AFN: 80_000, USD: 2_000 } },
  ];

  assert.deepEqual(sortCustomersForDisplay(rows, "balance_desc", "USD").map((row) => row.id), [2, 1]);
  assert.deepEqual(sortCustomersForDisplay(rows, "balance_desc", "AFN").map((row) => row.id), [1, 2]);
});

test("customer sorting provides deterministic name and date options", () => {
  const rows = [
    { id: 2, name: "Zahid", createdAt: "2026-01-02" },
    { id: 1, name: "Ali", createdAt: "2026-01-01" },
  ];

  assert.deepEqual(sortCustomersForDisplay(rows, "name_asc").map((row) => row.id), [1, 2]);
  assert.deepEqual(sortCustomersForDisplay(rows, "name_desc").map((row) => row.id), [2, 1]);
  assert.deepEqual(sortCustomersForDisplay(rows, "newest").map((row) => row.id), [2, 1]);
  assert.deepEqual(sortCustomersForDisplay(rows, "oldest").map((row) => row.id), [1, 2]);
});

test("city customer UI and API wire sort beside search", () => {
  const page = readFileSync("src/app/(dashboard)/customers/page.tsx", "utf8");
  const route = readFileSync("src/app/api/v1/customers/route.ts", "utf8");
  const table = readFileSync("src/components/ui/index.tsx", "utf8");

  assert.match(page, /sortOptions=\{user\?\.role === "city_admin" \? customerSortOptions : undefined\}/);
  assert.match(page, /params\.balance_currency = customerSortCurrency/);
  assert.match(route, /searchParams\.get\("balance_currency"\)/);
  assert.match(table, /aria-label="Sort rows"/);
});
