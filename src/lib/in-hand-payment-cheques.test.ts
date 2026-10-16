import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("all three Haji cheque loaders use complete pagination instead of all=1", () => {
  const payments = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");
  const haji = readFileSync("src/app/(dashboard)/haji-transfers/page.tsx", "utf8");
  assert.equal((payments.match(/fetchInHandPaymentCheques\(apiCall\)/g) || []).length, 1);
  assert.equal((haji.match(/fetchInHandPaymentCheques\(apiCall\)/g) || []).length, 2);
});

for (const total of [0, 35, 235]) {
  test(`loads all ${total} eligible cheques with bounded requests`, async () => {
    const { fetchInHandPaymentCheques } = await import("./in-hand-payment-cheques");
    const calls: number[] = [];
    const result = await fetchInHandPaymentCheques(async (url, { params }) => {
      assert.equal(url, "/api/v1/payments");
      assert.equal(params.status, "active");
      assert.equal(params.payment_method, "cheque");
      assert.equal(params.destination, "our_account");
      assert.equal(params.cheque_status, "in_hand");
      assert.equal(params.all, undefined);
      assert.ok(Number(params.limit) <= 100);
      const page = Number(params.page);
      // Simulate a server that caps pages at 15 regardless of requested size.
      calls.push(page);
      const start = (page - 1) * 15;
      return { success: true, data: Array.from({ length: Math.max(0, Math.min(15, total - start)) }, (_, i) => ({ id: start + i + 1 })), pagination: { page, limit: 15, total, totalPages: Math.ceil(total / 15) } };
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.length, total);
    assert.equal(calls.length, Math.max(1, Math.ceil(total / 15)));
  });
}

test("a failed later page never returns a partial cheque list", async () => {
  const { fetchInHandPaymentCheques } = await import("./in-hand-payment-cheques");
  const result = await fetchInHandPaymentCheques(async (_url, { params }) => Number(params.page) === 1
    ? { success: true, data: [{ id: 1 }], pagination: { page: 1, total: 2, totalPages: 2 } }
    : { success: false, error: "Connection lost" });
  assert.equal(result.success, false);
  assert.equal(result.data, undefined);
});

test("overlapping pages fail rather than silently omit cheques", async () => {
  const { fetchInHandPaymentCheques } = await import("./in-hand-payment-cheques");
  const result = await fetchInHandPaymentCheques(async (_url, { params }) => ({ success: true, data: [{ id: 1 }], pagination: { page: Number(params.page), total: 2, totalPages: 2 } }));
  assert.equal(result.success, false);
});

test("retry after a lost page starts from page one without accumulating duplicates", async () => {
  const { fetchInHandPaymentCheques } = await import("./in-hand-payment-cheques");
  let fail = true;
  const pages: number[] = [];
  const read = async (_url: string, { params }: { params: Record<string, string | number> }) => {
    const page = Number(params.page);
    pages.push(page);
    if (page === 2 && fail) return { success: false, error: "Connection lost" };
    return { success: true, data: [{ id: page }], pagination: { page, total: 2, totalPages: 2 } };
  };
  assert.equal((await fetchInHandPaymentCheques(read)).success, false);
  fail = false;
  assert.deepEqual((await fetchInHandPaymentCheques(read)).data, [{ id: 1 }, { id: 2 }]);
  assert.deepEqual(pages, [1, 2, 1, 2]);
});
