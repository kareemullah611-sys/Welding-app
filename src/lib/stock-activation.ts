import prisma from "@/lib/prisma";

/**
 * After new stock arrives in a godown, auto-activate any marked_short sales
 * whose items are now fully covered by available stock.
 *
 * Algorithm:
 *  1. Compute "free capacity" per product = received - active_sold - out + in
 *     (marked_short sales are NOT deducted — they are what we want to fulfil)
 *  2. Sort marked_short sales for this godown oldest-first
 *  3. Greedily activate oldest sales first as long as capacity covers all their items
 */
export async function autoActivateShortSales(godownId: number): Promise<number> {
  // Get all marked_short sales in this godown, oldest first
  const shortSales = await prisma.sale.findMany({
    where: { godownId, status: "marked_short" },
    include: { items: true },
    orderBy: [{ saleDate: "asc" }, { id: "asc" }],
  });

  if (!shortSales.length) return 0;

  // Gather all product IDs involved
  const productIds = Array.from(
    new Set(shortSales.flatMap((s) => s.items.map((i) => i.productId)))
  );

  // Free capacity = received - active_sold - transferredOut + transferredIn
  // (deliberately excludes marked_short so we can check if stock covers them)
  const freeCapacity: Record<number, number> = {};
  for (const productId of productIds) {
    const received = await prisma.lotCityGodownAllocation.aggregate({
      where: { godownId, productId },
      _sum: { qty: true },
    });
    const activeSold = await prisma.saleItem.aggregate({
      where: { productId, sale: { godownId, status: "active" } },
      _sum: { qty: true },
    });
    const out = await prisma.godownTransfer.aggregate({
      where: { fromGodownId: godownId, productId },
      _sum: { qty: true },
    });
    const inn = await prisma.godownTransfer.aggregate({
      where: { toGodownId: godownId, productId },
      _sum: { qty: true },
    });
    freeCapacity[productId] =
      Number(received._sum.qty || 0) -
      Number(activeSold._sum.qty || 0) -
      Number(out._sum.qty || 0) +
      Number(inn._sum.qty || 0);
  }

  let activated = 0;

  for (const sale of shortSales) {
    // Check if ALL items in this sale are within remaining free capacity
    const canActivate = sale.items.every(
      (item) => (freeCapacity[item.productId] ?? 0) >= Number(item.qty)
    );

    if (canActivate) {
      // Deduct this sale's items from free capacity
      for (const item of sale.items) {
        freeCapacity[item.productId] = (freeCapacity[item.productId] ?? 0) - Number(item.qty);
      }
      // Atomically activate only if still marked_short — prevents race condition where
      // two concurrent stock events both try to activate the same sale
      const { count } = await prisma.sale.updateMany({
        where: { id: sale.id, status: "marked_short" },
        data: { status: "active", stockShortFlag: false },
      });
      if (count > 0) activated++;
    }
  }

  return activated;
}
