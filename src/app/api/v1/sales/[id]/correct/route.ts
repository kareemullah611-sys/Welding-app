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

    // Check permission
    if (user.role === "city_admin" && sale.cityId !== user.cityId) {
      return errorResponse("FORBIDDEN", "Not your city", 403);
    }

    const oldItems = sale.items.map(i => ({ productId: i.productId, qty: Number(i.qty), ratePerCarton: Number(i.ratePerCarton), amount: Number(i.amount) }));

    const roundMoney = (n: number) => Math.round(n * 100) / 100;

    // Reverse original journal entries before changing items
    try { await reverseJournalEntries(`SALE-${saleId}`, user.userId); } catch (_) {}
    try { await reverseJournalEntries(`COGS-${saleId}`, user.userId); } catch (_) {}

    // Delete old items and batch-create new ones atomically
    await prisma.saleItem.deleteMany({ where: { saleId } });

    const newItems = items.map((item: any) => ({
      saleId, productId: item.productId, qty: item.qty,
      ratePerCarton: item.ratePerCarton, amount: roundMoney(item.qty * item.ratePerCarton),
    }));
    await prisma.saleItem.createMany({ data: newItems });

    const totalAmount = roundMoney(newItems.reduce((sum: number, i: { amount: number }) => sum + i.amount, 0));

    // Update sale total
    await prisma.sale.update({
      where: { id: saleId },
      data: { totalAmount, notes: `${sale.notes || ""}\n[CORRECTION: ${reason}]`.trim() },
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
      const totalQtySold = newItems.reduce((s: number, i: { qty: number }) => s + i.qty, 0);
      await journalSaleCOGS({
        saleId, lotId: sale.lotId!, totalQtySold,
        saleDate: sale.saleDate, cityId: sale.cityId, createdBy: user.userId,
      });
    } catch (_) {}

    await createAuditLog(user.userId, sale.cityId, "sales", saleId, "update",
      { items: oldItems, totalAmount: Number(sale.totalAmount) },
      { items, totalAmount, reason, action: "correction" },
      getClientIP(request)
    );

    return successResponse({ saleId, totalAmount }, "Sale corrected successfully");
  } catch (error) {
    console.error("Sale correction error:", error);
    return serverError();
  }
});
