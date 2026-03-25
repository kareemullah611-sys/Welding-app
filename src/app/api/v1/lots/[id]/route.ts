import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);

    const lot = await prisma.lot.findUnique({ where: { id }, include: { country: true, creator: { select: { id: true, fullName: true } } } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    // Separate safe queries
    let lotProducts: any[] = [];
    try { lotProducts = await prisma.lotProduct.findMany({ where: { lotId: id }, include: { product: true } }); } catch (e) {}

    let distributions: any[] = [];
    try {
      const dists = await prisma.lotCityDistribution.findMany({ where: { lotId: id }, include: { city: true, product: true, godownAllocations: { include: { godown: true } } } });
      distributions = dists.map((d: any) => ({
        cityId: d.cityId, cityName: d.city.name, productId: d.productId, productName: d.product.name,
        allocatedQty: Number(d.allocatedQty),
        godownAllocations: d.godownAllocations.map((ga: any) => ({ godownId: ga.godownId, godownName: ga.godown.name, qty: Number(ga.qty) })),
      }));
    } catch (e) {}

    if (user.role === "city_admin") {
      const hasCity = distributions.some((d: any) => d.cityId === user.cityId);
      if (!hasCity && distributions.length > 0) return errorResponse("FORBIDDEN", "Lot not in your city", 403);
    }

    let sales: any[] = [], payments: any[] = [], expenses: any[] = [], hajiTransfers: any[] = [];
    try { sales = await prisma.sale.findMany({ where: { lotId: id, status: "active" }, select: { id: true, voucherNo: true, totalAmount: true, saleDate: true, customer: { select: { name: true } }, items: { select: { qty: true, amount: true, product: { select: { name: true } } } } }, orderBy: { saleDate: "desc" }, take: 100 }); } catch (e) {}
    try { payments = await prisma.payment.findMany({ where: { lotId: id, status: "active" }, select: { id: true, amount: true, paymentDate: true, detail: true, customer: { select: { name: true } } }, orderBy: { paymentDate: "desc" }, take: 100 }); } catch (e) {}
    try { expenses = await prisma.expense.findMany({ where: { lotId: id }, select: { id: true, amount: true, detail: true, expenseDate: true }, orderBy: { expenseDate: "desc" } }); } catch (e) {}
    try { hajiTransfers = await prisma.hajiTransfer.findMany({ where: { lotId: id }, select: { id: true, amount: true, detail: true, transferDate: true, transferType: true }, orderBy: { transferDate: "desc" } }); } catch (e) {}

    let lotCosts: any[] = [], lotPurchases: any[] = [];
    try { lotCosts = await prisma.lotCost.findMany({ where: { lotId: id }, select: { id: true, costType: true, description: true, amount: true, currencyCode: true } }); } catch (e) {}
    try { lotPurchases = await prisma.lotPurchase.findMany({ where: { lotId: id }, select: { id: true, qty: true, unitPriceUsd: true, totalPriceUsd: true } }); } catch (e) {}

    const totalSales = sales.reduce((s: number, x: any) => s + Number(x.totalAmount), 0);
    const totalPayments = payments.reduce((s: number, x: any) => s + Number(x.amount), 0);
    const totalExpenses = expenses.reduce((s: number, x: any) => s + Number(x.amount), 0);
    const totalHaji = hajiTransfers.reduce((s: number, x: any) => s + Number(x.amount), 0);
    const totalPurchaseUsd = lotPurchases.reduce((s: number, x: any) => s + Number(x.totalPriceUsd || 0), 0);
    const totalLotCosts = lotCosts.reduce((s: number, x: any) => s + Number(x.amount), 0);
    // Include lot-tagged expenses in the additional costs / landed cost total
    const totalAdditionalCosts = totalLotCosts + totalExpenses;

    return successResponse({
      id: lot.id, lotNumber: lot.lotNumber, lotDate: lot.lotDate.toISOString().split("T")[0],
      status: lot.status, notes: lot.notes,
      country: { id: lot.country.id, name: lot.country.name, code: lot.country.code },
      createdBy: lot.creator,
      products: lotProducts.map((lp: any) => ({ productId: lp.productId, productName: lp.product.name, totalQty: Number(lp.totalQty) })),
      distributions,
      costSummary: { totalPurchaseUsd, totalLotCosts, totalLotExpenses: totalExpenses, totalAdditionalCosts, totalLanded: totalPurchaseUsd + totalAdditionalCosts, costBreakdown: lotCosts },
      summary: { totalSales, totalPayments, totalExpenses, totalHaji, outstanding: totalSales - totalPayments },
      recentSales: sales.map((s: any) => ({ ...s, totalAmount: Number(s.totalAmount), saleDate: s.saleDate.toISOString().split("T")[0] })),
      recentPayments: payments.map((p: any) => ({ ...p, amount: Number(p.amount), paymentDate: p.paymentDate.toISOString().split("T")[0] })),
      expenses: expenses.map((e: any) => ({ ...e, amount: Number(e.amount), expenseDate: e.expenseDate.toISOString().split("T")[0] })),
      hajiTransfers: hajiTransfers.map((h: any) => ({ ...h, amount: Number(h.amount), transferDate: h.transferDate.toISOString().split("T")[0] })),
    });
  } catch (error: any) {
    console.error("Lot detail error:", error?.message || error);
    return serverError();
  }
});

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const lot = await prisma.lot.findUnique({ where: { id } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    const updated = await prisma.lot.update({
      where: { id },
      data: { lotNumber: body.lotNumber || lot.lotNumber, lotDate: body.lotDate ? new Date(body.lotDate) : lot.lotDate, notes: body.notes !== undefined ? body.notes : lot.notes, updatedAt: new Date() },
    });

    // Add/update products if provided
    const warnings: string[] = [];
    if (body.products && Array.isArray(body.products)) {
      for (const p of body.products) {
        if (!p.productId || !p.totalQty) continue;
        const existing = await prisma.lotProduct.findUnique({
          where: { lotId_productId: { lotId: id, productId: p.productId } },
        });
        if (existing) {
          // Check cascade: if new qty < sum of city distributions for this product
          const distTotal = await prisma.lotCityDistribution.aggregate({
            where: { lotId: id, productId: p.productId },
            _sum: { allocatedQty: true },
          });
          const allocatedTotal = Number(distTotal._sum.allocatedQty || 0);
          if (allocatedTotal > Number(p.totalQty)) {
            const productName = existing ? (await prisma.product.findUnique({ where: { id: p.productId }, select: { name: true } }))?.name ?? `Product #${p.productId}` : `Product #${p.productId}`;
            warnings.push(`"${productName}": new qty ${p.totalQty} is less than already-distributed ${allocatedTotal} cartons. Distribution totals exceed new quantity — please update distributions.`);
          }
          await prisma.lotProduct.update({ where: { id: existing.id }, data: { totalQty: p.totalQty } });
        } else {
          await prisma.lotProduct.create({ data: { lotId: id, productId: p.productId, totalQty: p.totalQty } });
        }
      }
    }

    await createAuditLog(user.userId, null, "lots", id, "update", { lotNumber: lot.lotNumber, notes: lot.notes }, { lotNumber: updated.lotNumber, notes: updated.notes }, getClientIP(request));
    return successResponse({ id: updated.id, lotNumber: updated.lotNumber, warnings }, "Lot updated");
  } catch (error) {
    return serverError();
  }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const lot = await prisma.lot.findUnique({ where: { id } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
    // Check if lot has sales
    const salesCount = await prisma.sale.count({ where: { lotId: id, status: "active" } });
    if (salesCount > 0) return errorResponse("FORBIDDEN", `Cannot delete: lot has ${salesCount} active sales`, 403);
    // Delete related data first, then the lot
    await prisma.lotCityGodownAllocation.deleteMany({ where: { lotCityDistribution: { lotId: id } } });
    await prisma.lotCityDistribution.deleteMany({ where: { lotId: id } });
    await prisma.lotProduct.deleteMany({ where: { lotId: id } });
    try { await prisma.lotCost.deleteMany({ where: { lotId: id } }); } catch (e) {}
    try { await prisma.lotPurchase.deleteMany({ where: { lotId: id } }); } catch (e) {}
    try { await prisma.expense.deleteMany({ where: { lotId: id } }); } catch (e) {}
    try { await prisma.hajiTransfer.deleteMany({ where: { lotId: id } }); } catch (e) {}
    await prisma.lot.delete({ where: { id } });
    await createAuditLog(user.userId, null, "lots", id, "delete", { lotNumber: lot.lotNumber }, undefined, getClientIP(request));
    return successResponse({ id }, "Lot deleted");
  } catch (error: any) {
    console.error("Delete lot error:", error?.message);
    return serverError();
  }
});
