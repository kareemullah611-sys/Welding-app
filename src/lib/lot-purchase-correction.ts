import type { LotProductLandedCost } from "./lot-product-cost-allocation";

function roundPkr(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type LotPurchaseProductDelta = {
  productId: number;
  productName: string;
  operatingCogsPkr: number;
  historicalAdjustmentPkr: number;
  inventoryPkr: number;
};

export function buildLotPurchaseCorrectionDeltas(input: {
  beforeProducts: LotProductLandedCost[];
  afterProducts: LotProductLandedCost[];
  beforeSupplierBalances: Map<number, number>;
  afterSupplierBalances: Map<number, number>;
}) {
  for (const product of input.afterProducts) {
    if (product.operatingSoldStockQty + product.openingSoldStockQty > product.totalStockQty + 0.000001) {
      throw new Error(`${product.productName}: sold quantities exceed corrected product quantity`);
    }
  }

  const productIds = Array.from(new Set([
    ...input.beforeProducts.map((product) => product.productId),
    ...input.afterProducts.map((product) => product.productId),
  ])).sort((a, b) => a - b);
  const productDeltas = productIds.map((productId) => {
    const before = input.beforeProducts.find((product) => product.productId === productId);
    const after = input.afterProducts.find((product) => product.productId === productId);
    return {
      productId,
      productName: after?.productName || before?.productName || `Product #${productId}`,
      operatingCogsPkr: roundPkr((after?.operatingCogsPkr || 0) - (before?.operatingCogsPkr || 0)),
      historicalAdjustmentPkr: roundPkr((after?.historicalAdjustmentPkr || 0) - (before?.historicalAdjustmentPkr || 0)),
      inventoryPkr: roundPkr((after?.inventoryPkr || 0) - (before?.inventoryPkr || 0)),
    };
  }).filter((delta) => delta.operatingCogsPkr !== 0 || delta.historicalAdjustmentPkr !== 0 || delta.inventoryPkr !== 0);

  const supplierIds = Array.from(new Set([
    ...input.beforeSupplierBalances.keys(),
    ...input.afterSupplierBalances.keys(),
  ])).sort((a, b) => a - b);
  const supplierDeltas = supplierIds.map((supplierId) => ({
    supplierId,
    payablePkr: roundPkr((input.afterSupplierBalances.get(supplierId) || 0) - (input.beforeSupplierBalances.get(supplierId) || 0)),
  })).filter((delta) => delta.payablePkr !== 0);

  const productTotal = productDeltas.reduce(
    (sum, delta) => sum + delta.operatingCogsPkr + delta.historicalAdjustmentPkr + delta.inventoryPkr,
    0,
  );
  const supplierTotal = supplierDeltas.reduce((sum, delta) => sum + delta.payablePkr, 0);
  return {
    productDeltas,
    supplierDeltas,
    reconciliationDifferencePkr: roundPkr(productTotal - supplierTotal),
  };
}
