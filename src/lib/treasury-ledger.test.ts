import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPaymentCancellationReversalRow,
  computeRunningBalances,
  getCombinedItemNetDelta,
} from "@/lib/treasury-ledger";

const cashReceiptRaw = {
  destination: "our_account",
  paymentMethod: "cash",
};

describe("getCombinedItemNetDelta", () => {
  it("credits treasury for payment rows including cancelled originals", () => {
    const delta = getCombinedItemNetDelta({
      type: "payment",
      amount: 5000,
      currencyCode: "AFN",
      status: "cancelled",
      raw: cashReceiptRaw,
    });
    assert.equal(delta, 5000);
  });

  it("debits treasury for payment_reversal rows", () => {
    const delta = getCombinedItemNetDelta({
      type: "payment_reversal",
      amount: 5000,
      currencyCode: "AFN",
      raw: cashReceiptRaw,
    });
    assert.equal(delta, -5000);
  });

  it("counts active cash payments to our_account", () => {
    const delta = getCombinedItemNetDelta({
      type: "payment",
      amount: 5000,
      currencyCode: "AFN",
      status: "active",
      raw: cashReceiptRaw,
    });
    assert.equal(delta, 5000);
  });
});

describe("buildPaymentCancellationReversalRow", () => {
  it("builds a synthetic reversal row on cancel date", () => {
    const reversal = buildPaymentCancellationReversalRow({
      id: 42,
      status: "cancelled",
      cancelledAt: new Date("2026-03-15T10:00:00Z"),
      cancellationReason: "Duplicate entry",
      detail: "Customer payment",
      amount: 3000,
      currency: { symbol: "؋", code: "AFN" },
      customer: { name: "Ahmad" },
      destination: "our_account",
      paymentMethod: "cash",
    });
    assert.ok(reversal);
    assert.equal(reversal!.id, -42);
    assert.equal(reversal!.type, "payment_reversal");
    assert.equal(reversal!.date, "2026-03-15");
    assert.match(reversal!.detail, /Duplicate entry/);
  });
});

describe("computeRunningBalances", () => {
  it("keeps used cheque receipts in historical running balance", () => {
    const { itemsWithBalance } = computeRunningBalances(
      [
        {
          id: 1,
          type: "payment",
          date: "2026-07-13",
          amount: 1500000,
          currencyCode: "PKR",
          status: "active",
          raw: {
            ...cashReceiptRaw,
            paymentMethod: "cheque",
            chequeStatus: "sent_to_haji",
            createdAt: "2026-07-13T08:00:00.000Z",
          },
        },
        {
          id: 1,
          type: "haji_transfer",
          date: "2026-07-13",
          amount: 1500000,
          currencyCode: "PKR",
          raw: {
            sourceType: "cheque",
            createdAt: "2026-07-13T08:05:00.000Z",
          },
        },
      ],
      { PKR: 6271867 }
    );

    const byKey = new Map(itemsWithBalance.map((row) => [`${row.type}:${row.id}`, row.runningBalance]));
    assert.equal(byKey.get("payment:1"), 7771867);
    assert.equal(byKey.get("haji_transfer:1"), 6271867);
  });

  it("uses creation order for same-day mixed payment rows", () => {
    const { itemsWithBalance } = computeRunningBalances(
      [
        {
          id: 2,
          type: "payment",
          date: "2026-07-06",
          amount: 1000000,
          currencyCode: "PKR",
          status: "active",
          raw: {
            ...cashReceiptRaw,
            createdAt: "2026-07-06T19:18:09.294Z",
          },
        },
        {
          id: 1,
          type: "haji_transfer",
          date: "2026-07-06",
          amount: 100000,
          currencyCode: "PKR",
          raw: {
            sourceType: "cash_office",
            createdAt: "2026-07-06T19:15:35.682Z",
          },
        },
        {
          id: 1,
          type: "payment",
          date: "2026-07-06",
          amount: 1200000,
          currencyCode: "PKR",
          status: "active",
          raw: {
            ...cashReceiptRaw,
            createdAt: "2026-07-06T19:03:58.786Z",
          },
        },
      ],
      { PKR: 5263767 }
    );

    const byKey = new Map(itemsWithBalance.map((row) => [`${row.type}:${row.id}`, row.runningBalance]));
    assert.equal(byKey.get("payment:1"), 6463767);
    assert.equal(byKey.get("haji_transfer:1"), 6363767);
    assert.equal(byKey.get("payment:2"), 7363767);
  });

  it("nets cancelled payment plus reversal to match hand bookkeeping", () => {
    const { itemsWithBalance } = computeRunningBalances(
      [
        {
          id: 1,
          type: "payment",
          date: "2026-01-01",
          amount: 5000,
          currencyCode: "AFN",
          status: "cancelled",
          raw: cashReceiptRaw,
        },
        {
          id: -1,
          type: "payment_reversal",
          date: "2026-01-05",
          amount: 5000,
          currencyCode: "AFN",
          raw: cashReceiptRaw,
        },
        {
          id: 2,
          type: "payment",
          date: "2026-01-02",
          amount: 2000,
          currencyCode: "AFN",
          status: "active",
          raw: cashReceiptRaw,
        },
      ],
      { AFN: 0 }
    );

    const byId = new Map(itemsWithBalance.map((row) => [row.id, row.runningBalance]));
    assert.equal(byId.get(1), 5000);
    assert.equal(byId.get(2), 7000);
    assert.equal(byId.get(-1), 2000);
  });
});
