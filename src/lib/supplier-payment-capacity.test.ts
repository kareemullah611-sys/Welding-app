import test from "node:test";
import assert from "node:assert/strict";
import { calculateSupplierLotPaymentCapacity } from "./supplier-payment-capacity";

test("supplier lot payment capacity uses only that supplier's purchase lines", () => {
  const capacity = calculateSupplierLotPaymentCapacity({
    purchases: [
      { productId: 1, productName: "3.2mm", amountUsd: 6_000 },
      { productId: 2, productName: "4.0mm", amountUsd: 4_000 },
    ],
    payments: [{ amountUsd: 2_500 }, { amountUsd: 1_000 }],
  });

  assert.equal(capacity.purchaseTotalUsd, 10_000);
  assert.equal(capacity.paidTotalUsd, 3_500);
  assert.equal(capacity.outstandingUsd, 6_500);
  assert.deepEqual(capacity.products, [
    { productId: 1, productName: "3.2mm", amountUsd: 6_000 },
    { productId: 2, productName: "4.0mm", amountUsd: 4_000 },
  ]);
});

test("supplier lot payment capacity never exposes a negative payable amount", () => {
  const capacity = calculateSupplierLotPaymentCapacity({
    purchases: [{ productId: 1, productName: "3.2mm", amountUsd: 1_000 }],
    payments: [{ amountUsd: 1_200 }],
  });

  assert.equal(capacity.outstandingUsd, 0);
});
