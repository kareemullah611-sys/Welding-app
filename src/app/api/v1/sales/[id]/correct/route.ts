import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, createAuditLog, getClientIP } from "@/lib/middleware";
import { reverseJournalEntries, journalSaleCreated, journalSaleCOGS } from "@/lib/accounting";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// PUT /api/v1/sales/:id/correct - Correct items on a sale (wrong product given)
// Body: { items: [{ productId, qty, ratePerCarton }], reason: string }
export const PUT = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const saleId = parseInt(context.params.id);
    const body = await request.json();
    const { items, reason } = body;

    if (!items?.length) return errorResponse("VALIDATION_ERROR", "Provide corrected items");
    if (!reason) return errorResponse("VALIDATION_ERROR", "Provide a reason for correction");

    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true, currency: { select: { code: true } } },
    });
    if (!sale) return errorResponse("NOT_FOUND", "Sale not found", 404);
    if (sale.status !== "active") return errorResponse("VALIDATION_ERROR", "Can only correct active sales");

    if (user.role === "city_admin" && sale.cityId !== user.cityId) {
      return errorResponse("FORBIDDEN", "Not your city", 403);
    }

    // Fix P2: Validate all products exist and are active (same checks as sale creation)
    const productIds: number[] = items.map((i: any) => Number(i.productId));
    if (productIds.some(isNaN)) return errorResponse("VALIDATION_ERROR", "All items must have a valid productId");

    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });
    if (products.length !== productIds.length) {
      const foundIds = new Set(products.map((p) => p.id));
      const missing = productIds.filter((pid) => !foundIds.has(pid));
      return errorResponse("VALIDATION_ERROR", `Product(s) not found or inactive: ${missing.join(", ")}`);
    }

    for (const item of items) {
      if (!item.qty || Number(item.qty) <= 0) return errorResponse("VALIDATION_ERROR", "All item quantities must be > 0");
      if (!item.ratePerCarton || Number(item.ratePerCarton) <= 0) return errorResponse("VALIDATION_ERROR", "All item rates must be > 0");
    }

    const roundMoney = (n: number) => Math.round(n * 100) / 100;

    const oldItems = sale.items.map((i) => ({
      productId: i.productId, qty: Number(i.qty),
      ratePerCarton: Number(i.ratePerCarton), amount: Number(i.amount),
    }));

    const newItemData = items.map((item: any) => ({
      saleId,
      productId: Number(item.productId),
      qty: Number(item.qty),
      ratePerCarton: Number(item.ratePerCarton),
      amount: roundMoney(Number(item.qty) * Number(item.ratePerCarton)),
    }));
    const totalAmount = roundMoney(newItemData.reduce((sum: number, i: { amount: number }) => sum + i.amount, 0));

    // Reverse journals before mutation
    try { await reverseJournalEntries(`SALE-${saleId}`, user.userId); } catch (_) {}
    try { await reverseJournalEntries(`COGS-${saleId}`, user.userId); } catch (_) {}

    // Fix P3: Wrap delete + create + sale update in one transaction so a failure cannot
    // leave the sale with no items or a stale total while journals are already reversed.
    await prisma.$transaction(async (tx) => {
      await tx.saleItem.deleteMany({ where: { saleId } });
      await tx.saleItem.createMany({ data: newItemData });
      await tx.sale.update({
        where: { id: saleId },
        data: {
          totalAmount,
          notes: `${sale.notes || ""}\n[CORRECTION: ${reason}]`.trim(),
        },
      });
    });

    // Re-create journal entries with corrected total
    try {
      await journalSaleCreated({
        id: saleId, customerId: sale.customerId, cityId: sale.cityId,
        lotId: sale.lotId!, totalAmount, currencyCode: (sale as any).currency?.code || "PKR",
        saleDate: sale.saleDate, createdBy: user.userId,
      });
    } catch (_) {}
    try {
      const totalQtySold = newItemData.reduce((s: number, i: { qty: number }) => s + i.qty, 0);
      await journalSaleCOGS({
        saleId, lotId: sale.lotId!, totalQtySold,
        saleDate: sale.saleDate, cityId: sale.cityId, createdBy: user.userId,
      });
    } catch (_) {}

    await createAuditLog(user.userId, sale.cityId, "sales", saleId, "update",
      { items: oldItems, totalAmount: Number(sale.totalAmount) },
      { items: newItemData.map(({ saleId: _s, ...rest }: any) => rest), totalAmount, reason, action: "correction" },
      getClientIP(request)
    );

    return successResponse({ saleId, totalAmount }, "Sale corrected successfully");
  } catch (error) {
    console.error("Sale correction error:", error);
    return serverError();
  }
});
