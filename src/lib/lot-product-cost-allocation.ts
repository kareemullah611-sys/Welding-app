export type LotCostAllocationBasis = "purchase_value" | "weight" | "cartons" | "specific_product";

export type LotProductCostInput = {
  productId: number;
  productName: string;
  purchaseValuePkr: number;
  weightKg: number;
  cartonQty: number;
  totalStockQty: number;
  operatingSoldStockQty: number;
  openingSoldStockQty: number;
};

export type LotProductCostAllocation = {
  productId: number;
  productName: string;
  allocatedCostPkr: number;
  operatingCogsPkr: number;
  historicalAdjustmentPkr: number;
  inventoryPkr: number;
};

export type LotProductLandedCost = LotProductCostInput & {
  additionalCostPkr: number;
  totalLandedCostPkr: number;
  unitCostPkr: number;
  operatingCogsPkr: number;
  historicalAdjustmentPkr: number;
  inventoryPkr: number;
};

function roundPkr(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function defaultLotCostAllocationBasis(costType: string): LotCostAllocationBasis | null {
  if (costType === "customs_duty") return "purchase_value";
  if (costType === "freight" || costType === "transport") return "weight";
  if (costType === "loading_unloading") return "cartons";
  return null;
}

function allocationWeight(product: LotProductCostInput, basis: LotCostAllocationBasis, allocatedProductId?: number | null) {
  if (basis === "purchase_value") return product.purchaseValuePkr;
  if (basis === "weight") return product.weightKg;
  if (basis === "cartons") return product.cartonQty;
  return product.productId === allocatedProductId ? 1 : 0;
}

export function allocateLotCostAcrossProducts(input: {
  amountPkr: number;
  basis: LotCostAllocationBasis;
  allocatedProductId?: number | null;
  products: LotProductCostInput[];
}): LotProductCostAllocation[] {
  if (!Number.isFinite(input.amountPkr) || input.amountPkr < 0) throw new Error("Lot cost amount must be zero or greater");
  if (input.products.length === 0) throw new Error("Lot has no products to allocate cost against");
  if (input.basis === "specific_product" && !input.allocatedProductId) throw new Error("A specific product is required");

  for (const product of input.products) {
    const soldQty = product.operatingSoldStockQty + product.openingSoldStockQty;
    if (product.totalStockQty <= 0) throw new Error(`${product.productName}: lot product quantity must be greater than zero`);
    if (soldQty > product.totalStockQty + 0.000001) throw new Error(`${product.productName}: sold quantities exceed corrected product quantity`);
    if (input.basis === "weight" && product.weightKg <= 0) throw new Error(`${product.productName}: product weight is required for weight allocation`);
  }

  const weights = input.products.map((product) => allocationWeight(product, input.basis, input.allocatedProductId));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) throw new Error(`Lot cost allocation basis ${input.basis} has no usable value`);
  const lastWeightedIndex = weights.reduce((last, weight, index) => weight > 0 ? index : last, -1);

  let allocatedSoFar = 0;
  return input.products.map((product, index) => {
    const allocatedCostPkr = index === lastWeightedIndex
      ? roundPkr(input.amountPkr - allocatedSoFar)
      : roundPkr(input.amountPkr * weights[index] / totalWeight);
    allocatedSoFar = roundPkr(allocatedSoFar + allocatedCostPkr);

    const operatingCogsPkr = roundPkr(allocatedCostPkr * product.operatingSoldStockQty / product.totalStockQty);
    const historicalAdjustmentPkr = roundPkr(allocatedCostPkr * product.openingSoldStockQty / product.totalStockQty);
    const inventoryPkr = roundPkr(allocatedCostPkr - operatingCogsPkr - historicalAdjustmentPkr);
    return {
      productId: product.productId,
      productName: product.productName,
      allocatedCostPkr,
      operatingCogsPkr,
      historicalAdjustmentPkr,
      inventoryPkr,
    };
  });
}

export function calculateLotProductLandedCosts(input: {
  products: LotProductCostInput[];
  costs: Array<{
    amountPkr: number;
    basis: LotCostAllocationBasis;
    allocatedProductId?: number | null;
  }>;
}): LotProductLandedCost[] {
  for (const product of input.products) {
    if (product.totalStockQty <= 0) throw new Error(`${product.productName}: lot product quantity must be greater than zero`);
    if (product.operatingSoldStockQty + product.openingSoldStockQty > product.totalStockQty + 0.000001) {
      throw new Error(`${product.productName}: sold quantities exceed corrected product quantity`);
    }
  }
  const additionalByProduct = new Map(input.products.map((product) => [product.productId, 0]));
  for (const cost of input.costs) {
    for (const allocation of allocateLotCostAcrossProducts({ ...cost, products: input.products })) {
      additionalByProduct.set(
        allocation.productId,
        roundPkr((additionalByProduct.get(allocation.productId) || 0) + allocation.allocatedCostPkr),
      );
    }
  }

  return input.products.map((product) => {
    const additionalCostPkr = additionalByProduct.get(product.productId) || 0;
    const totalLandedCostPkr = roundPkr(product.purchaseValuePkr + additionalCostPkr);
    const unitCostPkr = roundPkr(totalLandedCostPkr / product.totalStockQty);
    const operatingCogsPkr = roundPkr(unitCostPkr * product.operatingSoldStockQty);
    const historicalAdjustmentPkr = roundPkr(unitCostPkr * product.openingSoldStockQty);
    const inventoryPkr = roundPkr(totalLandedCostPkr - operatingCogsPkr - historicalAdjustmentPkr);
    return {
      ...product,
      additionalCostPkr,
      totalLandedCostPkr,
      unitCostPkr,
      operatingCogsPkr,
      historicalAdjustmentPkr,
      inventoryPkr,
    };
  });
}
