type ExistingPurchase = { id: number; productId: number };
type IncomingPurchase = { id?: number; productId: number };

export type ProductReclassification = { fromProductId: number; toProductId: number };

export function buildProductReclassifications(
  existingPurchases: ExistingPurchase[],
  incomingPurchases: IncomingPurchase[],
  nextProductIds: Set<number>,
  distributedProductIds: Set<number>,
): ProductReclassification[] {
  const incomingById = new Map(
    incomingPurchases.filter((item): item is IncomingPurchase & { id: number } => Boolean(item.id)).map((item) => [item.id, item]),
  );
  const targetsBySource = new Map<number, Set<number>>();
  for (const existing of existingPurchases) {
    const incoming = incomingById.get(existing.id);
    if (!incoming || incoming.productId === existing.productId) continue;
    const targets = targetsBySource.get(existing.productId) || new Set<number>();
    targets.add(incoming.productId);
    targetsBySource.set(existing.productId, targets);
  }

  const result: ProductReclassification[] = [];
  for (const fromProductId of distributedProductIds) {
    if (nextProductIds.has(fromProductId)) continue;
    const targets = targetsBySource.get(fromProductId);
    if (!targets) {
      throw new Error("AMBIGUOUS_PRODUCT_RECLASSIFICATION");
    }
    if (targets.size !== 1 || nextProductIds.has(fromProductId)) {
      throw new Error("AMBIGUOUS_PRODUCT_RECLASSIFICATION");
    }
    result.push({ fromProductId, toProductId: [...targets][0] });
  }
  if (new Set(result.map(({ toProductId }) => toProductId)).size !== result.length) {
    throw new Error("AMBIGUOUS_PRODUCT_RECLASSIFICATION");
  }
  return result;
}
