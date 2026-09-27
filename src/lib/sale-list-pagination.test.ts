import assert from "node:assert/strict";
import test from "node:test";
import { paginateSaleDisplayRows } from "./sale-list-pagination";

function sale(id: number, itemCount: number) {
  return {
    id,
    totalAmount: itemCount * 100,
    lot: { id: id, lotNumber: `LOT-${id}` },
    items: Array.from({ length: itemCount }, (_, index) => ({
      id: id * 10 + index,
      productId: index + 1,
      lotId: id,
      lot: { id, lotNumber: `LOT-${id}` },
      qty: 1,
      ratePerCarton: 100,
      amount: 100,
    })),
  };
}

test("sales pagination counts visible item rows rather than parent sales", () => {
  const sales = Array.from({ length: 15 }, (_, index) => sale(index + 1, 2));

  const firstPage = paginateSaleDisplayRows(sales, 1, 20);
  const secondPage = paginateSaleDisplayRows(sales, 2, 20);

  assert.equal(firstPage.total, 30);
  assert.equal(firstPage.totalPages, 2);
  assert.equal(firstPage.items.length, 20);
  assert.equal(secondPage.items.length, 10);
  assert.ok(firstPage.items.every((row) => row.items?.length === 1));
  assert.ok(firstPage.items.every((row) => row.sourceItems.length === 2));
});

test("sales pagination merges duplicate display allocations before counting rows", () => {
  const source = sale(1, 2);
  source.items[1] = { ...source.items[0], id: 99, qty: 2, amount: 200 };

  const page = paginateSaleDisplayRows([source], 1, 20);

  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.items?.[0]?.qty, 3);
  assert.equal(page.items[0]?.items?.[0]?.amount, 300);
});
