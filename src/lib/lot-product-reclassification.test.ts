import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildProductReclassifications } from "./lot-product-reclassification";

const route = readFileSync("src/app/api/v1/lots/[id]/route.ts", "utf8");

test("lot edit reclassifies distributed and godown-assigned stock with its corrected product", () => {
  assert.deepEqual(
    buildProductReclassifications(
      [{ id: 7, productId: 10 }],
      [{ id: 7, productId: 20 }],
      new Set([20]),
      new Set([10]),
    ),
    [{ fromProductId: 10, toProductId: 20 }],
  );
  assert.match(route, /productReclassifications/);
  assert.match(route, /lotCityGodownAllocation\.updateMany/);
  assert.match(route, /lotCityDistribution\.updateMany/);
  assert.match(route, /targetDistributedQty \+ distributedQty/);
  assert.match(route, /action: "reclassify_product"/);
});

test("lot product reclassification cascades through sales and transfers", () => {
  assert.match(route, /saleItem\.updateMany/);
  assert.match(route, /godownTransfer\.updateMany/);
  assert.match(route, /cityTransfer\.updateMany/);
  assert.doesNotMatch(route, /PRODUCT_RECLASSIFICATION_HAS_MOVEMENTS/);
});

test("lot product reclassification rejects ambiguous mappings and destination collisions", () => {
  assert.throws(
    () => buildProductReclassifications(
      [{ id: 7, productId: 10 }, { id: 8, productId: 10 }],
      [{ id: 7, productId: 20 }, { id: 8, productId: 30 }],
      new Set([20, 30]),
      new Set([10]),
    ),
    /AMBIGUOUS_PRODUCT_RECLASSIFICATION/,
  );
  assert.match(route, /AMBIGUOUS_PRODUCT_RECLASSIFICATION/);
  assert.match(route, /PRODUCT_RECLASSIFICATION_COLLISION/);
});

test("removing a distributed product without an identifiable replacement is rejected", () => {
  assert.throws(
    () => buildProductReclassifications(
      [{ id: 7, productId: 10 }],
      [{ productId: 20 }],
      new Set([20]),
      new Set([10]),
    ),
    /AMBIGUOUS_PRODUCT_RECLASSIFICATION/,
  );
});
