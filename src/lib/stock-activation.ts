import prisma from "@/lib/prisma";
import { journalSaleCOGSForLots } from "@/lib/accounting";
import { lockGodownProductStock } from "@/lib/financial-locks";

/**
 * After new stock arrives in a godown, auto-activate any marked_short sales
 * whose items are now fully covered by available stock.
 *
 * Algorithm:
 *  1. Compute "free capacity" per product = received - active_sold - out + in
 *     (marked_short sales are NOT deducted — they are what we want to fulfil)
 *  2. Sort marked_short sales for this godown oldest-first
 *  3. Greedily activate oldest sales first as long as capacity covers all their items
 *
 * Fix C4: when a marked_short sale flips to active, we post the deferred COGS journal
 * entry that was skipped at sale-creation time.
 */
export async function autoActivateShortSales(godownId: number): Promise<number> {
  return prisma.$transaction(async (tx) => {
    let shortSales = await tx.sale.findMany({
      where: { godownId, status: "marked_short" },
      include: { items: true },
      orderBy: [{ saleDate: "asc" }, { id: "asc" }],
    });
    if (!shortSales.length) return 0;

    const productIds = Array.from(new Set(shortSales.flatMap((sale) => sale.items.map((item) => item.productId))));
    await lockGodownProductStock(tx, productIds.map((productId) => ({ godownId, productId })));
    shortSales = await tx.sale.findMany({
      where: { godownId, status: "marked_short" },
      include: { items: true },
      orderBy: [{ saleDate: "asc" }, { id: "asc" }],
    });

    const freeCapacity: Record<number, number> = {};
    for (const productId of productIds) {
      const [received, activeSold, out, inn] = await Promise.all([
        tx.lotCityGodownAllocation.aggregate({ where: { godownId, productId }, _sum: { qty: true } }),
        tx.saleItem.aggregate({ where: { productId, sale: { godownId, status: "active" } }, _sum: { qty: true } }),
        tx.godownTransfer.aggregate({ where: { fromGodownId: godownId, productId }, _sum: { qty: true } }),
        tx.godownTransfer.aggregate({ where: { toGodownId: godownId, productId }, _sum: { qty: true } }),
      ]);
      freeCapacity[productId] = Number(received._sum.qty || 0)
        - Number(activeSold._sum.qty || 0)
        - Number(out._sum.qty || 0)
        + Number(inn._sum.qty || 0);
    }

    let activated = 0;
    for (const sale of shortSales) {
      if (!sale.items.every((item) => (freeCapacity[item.productId] ?? 0) >= Number(item.qty))) continue;
      for (const item of sale.items) {
        freeCapacity[item.productId] = (freeCapacity[item.productId] ?? 0) - Number(item.qty);
      }
      const { count } = await tx.sale.updateMany({
        where: { id: sale.id, status: "marked_short" },
        data: { status: "active", stockShortFlag: false },
      });
      if (count === 0) continue;

      const qtyByLot = sale.items.reduce((acc: Record<number, number>, item) => {
        const lotId = Number(item.lotId || sale.lotId);
        acc[lotId] = (acc[lotId] || 0) + Number(item.qty);
        return acc;
      }, {});
      await journalSaleCOGSForLots({
        saleId: sale.id,
        allocations: (Object.entries(qtyByLot) as Array<[string, number]>).map(([lotId, totalQtySold]) => ({
          lotId: Number(lotId),
          totalQtySold,
        })),
        saleDate: sale.saleDate,
        cityId: sale.cityId,
        createdBy: sale.createdBy,
      }, tx);
      activated++;
    }
    return activated;
  });
}
