type StockProduct = {
  productId: number;
  productName: string;
  unitOfMeasure?: string | null;
  piecesPerCarton?: number | null;
  originalQty: number;
  openingUnitCostPkr?: number | null;
};

type PurchaseSource = {
  id: number;
  productId: number;
  supplierName: string;
  originalAmountUsd: number;
  carryingAmountPkr: number | null;
};

type QuantityMovement = { productId: number; qty: number };
type CityQuantityMovement = QuantityMovement & { status: string };

export type LotStockTraceRow = {
  productId: number;
  productName: string;
  originalQuantity: number;
  distributedQuantity: number;
  internalTransferQuantity: number;
  soldQuantity: number;
  remainingQuantity: number;
  purchaseIds: number[];
  supplierNames: string[];
  originalPurchaseUsd: number;
  purchaseCarryingPkr: number | null;
  allocatedAdditionalCostPkr: number | null;
  landedCostPkr: number | null;
  unitCarryingCostPkr: number | null;
  remainingStockValuePkr: number | null;
  quantityDifference: number;
  blockers: string[];
};

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function displayQuantity(value: number, product: Pick<StockProduct, "unitOfMeasure" | "piecesPerCarton">) {
  const piecesPerCarton = Number(product.piecesPerCarton || 0);
  return product.unitOfMeasure === "PCS" && piecesPerCarton > 0
    ? value / piecesPerCarton
    : value;
}

function sumMovements(rows: QuantityMovement[], productId: number, product: StockProduct) {
  return rows
    .filter((row) => row.productId === productId)
    .reduce((sum, row) => sum + displayQuantity(Number(row.qty || 0), product), 0);
}

export function buildLotStockTrace(input: {
  lotProducts: StockProduct[];
  purchases: PurchaseSource[];
  distributed: QuantityMovement[];
  sales: QuantityMovement[];
  godownTransfers: QuantityMovement[];
  cityTransfers: CityQuantityMovement[];
  additionalLandedCostPkr: number;
  additionalLandedCostByProductPkr?: Record<number, number>;
}): LotStockTraceRow[] {
  const totalOriginalQuantity = input.lotProducts.reduce(
    (sum, product) => sum + displayQuantity(Number(product.originalQty || 0), product),
    0,
  );

  return input.lotProducts.map((product) => {
    const originalQuantity = displayQuantity(Number(product.originalQty || 0), product);
    const productPurchases = input.purchases.filter((purchase) => purchase.productId === product.productId);
    const blockers: string[] = [];
    const openingUnitCostPkr = Number(product.openingUnitCostPkr || 0);
    const hasOpeningBasis = openingUnitCostPkr > 0;
    const hasPurchaseBasis = productPurchases.length > 0
      && productPurchases.every((purchase) => Number(purchase.carryingAmountPkr || 0) > 0);

    if (!hasOpeningBasis && !hasPurchaseBasis) blockers.push("Missing authoritative PKR purchase carrying basis");

    const purchaseCarryingPkr = hasOpeningBasis
      ? originalQuantity * openingUnitCostPkr
      : hasPurchaseBasis
      ? productPurchases.reduce((sum, purchase) => sum + Number(purchase.carryingAmountPkr || 0), 0)
      : null;
    const productSpecificAdditionalCost = input.additionalLandedCostByProductPkr?.[product.productId];
    const allocatedAdditionalCostPkr = purchaseCarryingPkr == null
      ? null
      : productSpecificAdditionalCost != null
      ? Number(productSpecificAdditionalCost)
      : totalOriginalQuantity > 0
      ? Number(input.additionalLandedCostPkr || 0) * (originalQuantity / totalOriginalQuantity)
      : 0;
    const landedCostPkr = purchaseCarryingPkr == null || allocatedAdditionalCostPkr == null
      ? null
      : purchaseCarryingPkr + allocatedAdditionalCostPkr;
    const unitCarryingCostPkr = landedCostPkr == null || originalQuantity <= 0
      ? null
      : landedCostPkr / originalQuantity;
    const soldQuantity = sumMovements(input.sales, product.productId, product);
    const remainingQuantity = originalQuantity - soldQuantity;
    if (remainingQuantity < 0) blockers.push("Sales exceed original lot quantity");
    const distributedQuantity = sumMovements(input.distributed, product.productId, product);
    const approvedCityTransfers = input.cityTransfers.filter((row) => row.status === "approved");
    const internalTransferQuantity = sumMovements(input.godownTransfers, product.productId, product)
      + sumMovements(approvedCityTransfers, product.productId, product);

    return {
      productId: product.productId,
      productName: product.productName,
      originalQuantity: round2(originalQuantity),
      distributedQuantity: round2(distributedQuantity),
      internalTransferQuantity: round2(internalTransferQuantity),
      soldQuantity: round2(soldQuantity),
      remainingQuantity: round2(remainingQuantity),
      purchaseIds: productPurchases.map((purchase) => purchase.id),
      supplierNames: [...new Set(productPurchases.map((purchase) => purchase.supplierName).filter(Boolean))],
      originalPurchaseUsd: round2(productPurchases.reduce((sum, purchase) => sum + Number(purchase.originalAmountUsd || 0), 0)),
      purchaseCarryingPkr: purchaseCarryingPkr == null ? null : round2(purchaseCarryingPkr),
      allocatedAdditionalCostPkr: allocatedAdditionalCostPkr == null ? null : round2(allocatedAdditionalCostPkr),
      landedCostPkr: landedCostPkr == null ? null : round2(landedCostPkr),
      unitCarryingCostPkr: unitCarryingCostPkr == null ? null : round2(unitCarryingCostPkr),
      remainingStockValuePkr: unitCarryingCostPkr == null ? null : round2(remainingQuantity * unitCarryingCostPkr),
      quantityDifference: round2(originalQuantity - soldQuantity - remainingQuantity),
      blockers,
    };
  });
}
