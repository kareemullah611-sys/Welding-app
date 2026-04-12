import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);

    const lot = await prisma.lot.findUnique({ where: { id }, include: { country: true, creator: { select: { id: true, fullName: true } } } }) as any;
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    if (user.role === "city_admin") {
      if (!user.cityId || !user.countryId || lot.countryId !== user.countryId) {
        return errorResponse("FORBIDDEN", "Lot not in your city scope", 403);
      }
      const cityDistributionCount = await prisma.lotCityDistribution.count({
        where: { lotId: id, cityId: user.cityId },
      });
      if (cityDistributionCount === 0) {
        return errorResponse("FORBIDDEN", "Lot not in your city", 403);
      }
    }

    // Separate safe queries
    let lotProducts: any[] = [];
    try { lotProducts = await prisma.lotProduct.findMany({ where: { lotId: id }, include: { product: true } }); } catch (e) {}

    let distributions: any[] = [];
    try {
      const dists = await prisma.lotCityDistribution.findMany({
        where: { lotId: id, ...(user.role === "city_admin" ? { cityId: user.cityId! } : {}) },
        include: { city: true, product: true, godownAllocations: { include: { godown: true } } },
      });
      distributions = dists.map((d: any) => ({
        cityId: d.cityId, cityName: d.city.name, productId: d.productId, productName: d.product.name,
        allocatedQty: Number(d.allocatedQty),
        godownAllocations: d.godownAllocations.map((ga: any) => ({ godownId: ga.godownId, godownName: ga.godown.name, qty: Number(ga.qty) })),
      }));
    } catch (e) {}

    let sales: any[] = [], payments: any[] = [], expenses: any[] = [], hajiTransfers: any[] = [];
    try { sales = await prisma.sale.findMany({ where: { lotId: id, status: "active" }, select: { id: true, voucherNo: true, totalAmount: true, saleDate: true, customer: { select: { name: true } }, items: { select: { qty: true, amount: true, product: { select: { id: true, name: true } } } } }, orderBy: { saleDate: "desc" }, take: 100 }); } catch (e) {}
    try { payments = await prisma.payment.findMany({ where: { lotId: id, status: "active" }, select: { id: true, amount: true, paymentDate: true, detail: true, customer: { select: { name: true } } }, orderBy: { paymentDate: "desc" }, take: 100 }); } catch (e) {}
    try { expenses = await prisma.expense.findMany({ where: { lotId: id, deletedAt: null }, select: { id: true, amount: true, detail: true, expenseDate: true, currency: { select: { code: true } } }, orderBy: { expenseDate: "desc" } }); } catch (e) {}
    try { hajiTransfers = await prisma.hajiTransfer.findMany({ where: { lotId: id }, select: { id: true, amount: true, detail: true, transferDate: true, transferType: true }, orderBy: { transferDate: "desc" } }); } catch (e) {}

    let lotCosts: any[] = [], lotPurchases: any[] = [];
    try {
      lotCosts = await prisma.lotCost.findMany({
        where: { lotId: id },
        select: {
          id: true,
          costType: true,
          description: true,
          amount: true,
          currencyCode: true,
          exchangeRate: true,
          costDate: true,
          notes: true,
          paidFromCash: true,
          bankAccountId: true,
          superAdminBankAccountId: true,
          intermediaryId: true,
          agentId: true,
          shippingLineId: true,
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          superAdminBankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          intermediary: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true } },
          shippingLine: { select: { id: true, name: true } },
        },
      });
    } catch (e) {}
    try {
      lotPurchases = await prisma.lotPurchase.findMany({
        where: { lotId: id },
        include: {
          supplier: { select: { id: true, name: true } },
          product: { select: { id: true, name: true } },
        },
        orderBy: { id: "asc" },
      });
    } catch (e) {}

    const lotCostIds = lotCosts.map((c: any) => Number(c.id));
    const lotPurchaseIds = lotPurchases.map((p: any) => Number(p.id));

    const [lotAuditLogs, lotCostAuditLogs, lotPurchaseAuditLogs, lotAssignmentAuditLogs] = await Promise.all([
      prisma.auditLog.findMany({
        where: { entityType: "lots", entityId: id },
        include: { user: { select: { id: true, fullName: true } }, city: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
      lotCostIds.length > 0
        ? prisma.auditLog.findMany({
            where: { entityType: "lot_costs", entityId: { in: lotCostIds } },
            include: { user: { select: { id: true, fullName: true } }, city: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
            take: 60,
          })
        : Promise.resolve([] as any[]),
      prisma.auditLog.findMany({
        where: {
          entityType: "lot_purchases",
          OR: [
            { entityId: id }, // bulk-create entry logs using lot id
            ...(lotPurchaseIds.length > 0 ? [{ entityId: { in: lotPurchaseIds } }] : []),
          ],
        },
        include: { user: { select: { id: true, fullName: true } }, city: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
      prisma.auditLog.findMany({
        where: { entityType: "lot_city_godown_allocations", entityId: id },
        include: { user: { select: { id: true, fullName: true } }, city: { select: { id: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
    ]);

    const totalSales = sales.reduce((s: number, x: any) => s + Number(x.totalAmount), 0);
    const totalPayments = payments.reduce((s: number, x: any) => s + Number(x.amount), 0);
    const totalExpenses = expenses.reduce((s: number, x: any) => s + Number(x.amount), 0);
    const totalHaji = hajiTransfers.reduce((s: number, x: any) => s + Number(x.amount), 0);
    const totalPurchaseUsd = lotPurchases.reduce((s: number, x: any) => s + Number(x.totalPriceUsd || 0), 0);
    const soldQtyByProduct: Record<number, number> = {};
    for (const s of sales) {
      for (const item of s.items || []) {
        const productId = Number(item.product?.id || 0);
        if (!productId) continue;
        soldQtyByProduct[productId] = (soldQtyByProduct[productId] || 0) + Number(item.qty || 0);
      }
    }
    const stockByProduct = lotProducts.map((lp: any) => {
      const totalQty = Number(lp.totalQty || 0);
      const soldQty = Number(soldQtyByProduct[lp.productId] || 0);
      return {
        productId: lp.productId,
        productName: lp.product.name,
        totalQty,
        soldQty: Math.min(totalQty, soldQty),
        remainingQty: Math.max(0, totalQty - soldQty),
      };
    });
    const totalCartons = stockByProduct.reduce((s: number, p: any) => s + Number(p.totalQty), 0);
    const soldCartons = stockByProduct.reduce((s: number, p: any) => s + Number(p.soldQty), 0);
    const remainingCartons = stockByProduct.reduce((s: number, p: any) => s + Number(p.remainingQty), 0);

    // Group lot costs by currency — avoids mixing PKR + USD into a meaningless total
    const costsByCurrency: Record<string, number> = {};
    for (const c of lotCosts) {
      const code = c.currencyCode || "PKR";
      costsByCurrency[code] = (costsByCurrency[code] || 0) + Number(c.amount);
    }
    const lotExpensesByCurrency: Record<string, number> = {};
    for (const e of expenses) {
      const code = e.currency?.code || "PKR";
      lotExpensesByCurrency[code] = (lotExpensesByCurrency[code] || 0) + Number(e.amount);
    }
    const costBreakdown = lotCosts.map((c: any) => {
      let debitChannel = "payable";
      let debitChannelLabel = "General Payable";
      if (c.shippingLineId) {
        debitChannel = "shipping_line";
        debitChannelLabel = `Shipping Line: ${c.shippingLine?.name || `#${c.shippingLineId}`}`;
      } else if (c.agentId) {
        debitChannel = "agent";
        debitChannelLabel = `Agent: ${c.agent?.name || `#${c.agentId}`}`;
      } else if (c.intermediaryId) {
        debitChannel = "intermediary";
        debitChannelLabel = `Intermediary: ${c.intermediary?.name || `#${c.intermediaryId}`}`;
      } else if (c.superAdminBankAccountId) {
        debitChannel = "super_admin_bank";
        debitChannelLabel = `Super Admin Bank: ${c.superAdminBankAccount?.bankName || `#${c.superAdminBankAccountId}`}${c.superAdminBankAccount?.accountNumber ? ` (${c.superAdminBankAccount.accountNumber})` : ""}`;
      } else if (c.bankAccountId) {
        debitChannel = "bank";
        debitChannelLabel = `Bank: ${c.bankAccount?.bankName || `#${c.bankAccountId}`}${c.bankAccount?.accountNumber ? ` (${c.bankAccount.accountNumber})` : ""}`;
      } else if (c.paidFromCash) {
        debitChannel = "cash";
        debitChannelLabel = "Cash";
      }

      return {
        ...c,
        debitChannel,
        debitChannelLabel,
      };
    });

    const describeAuditLog = (log: any): { title: string; detail: string } => {
      const newValues = (log.newValues || {}) as any;
      const oldValues = (log.oldValues || {}) as any;

      if (log.entityType === "lots") {
        if (log.action === "create") return { title: "Lot created", detail: `Lot #${newValues?.lotNumber || lot.lotNumber}` };
        if (newValues?.action === "distribute") return { title: "City distribution updated", detail: "Lot quantities were distributed across cities." };
        if (newValues?.action === "reopen") return { title: "Lot reopened", detail: "Lot status changed from completed to ongoing." };
        if (newValues?.status === "completed") return { title: "Lot completed", detail: "Lot status changed to completed." };
        if (log.action === "update") return { title: "Lot details updated", detail: "Lot metadata was edited." };
        if (log.action === "delete") return { title: "Lot deleted", detail: "Lot and related data were removed." };
      }

      if (log.entityType === "lot_costs") {
        const amount = Number(newValues?.amount || oldValues?.amount || 0);
        const currency = String(newValues?.currencyCode || oldValues?.currencyCode || "").toUpperCase();
        const description = String(newValues?.description || oldValues?.description || "Lot cost");
        if (log.action === "create") return { title: "Cost added", detail: `${description} · ${currency} ${amount.toLocaleString("en-US")}` };
        if (log.action === "update") return { title: "Cost edited", detail: `${description} updated` };
        if (log.action === "delete") return { title: "Cost removed", detail: `${description} deleted` };
      }

      if (log.entityType === "lot_purchases") {
        if (log.action === "create") return { title: "Purchase lines added", detail: "Purchase invoice lines were recorded." };
        if (log.action === "update") return { title: "Purchase line edited", detail: "Quantity/price values were updated." };
        if (log.action === "delete") return { title: "Purchase line removed", detail: "A purchase line was deleted." };
      }

      if (log.entityType === "lot_city_godown_allocations") {
        return { title: "Godown assignments updated", detail: "City distribution quantities were assigned to godowns." };
      }

      return { title: `${String(log.entityType || "record").replaceAll("_", " ")} ${log.action}`, detail: "Operational update recorded." };
    };

    const auditTimeline = [...lotAuditLogs, ...lotCostAuditLogs, ...lotPurchaseAuditLogs, ...lotAssignmentAuditLogs]
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 80)
      .map((log: any) => {
        const { title, detail } = describeAuditLog(log);
        return {
          id: log.id,
          createdAt: log.createdAt.toISOString(),
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          title,
          detail,
          actorName: log.user?.fullName || "System",
          cityName: log.city?.name || null,
        };
      });

    return successResponse({
      id: lot.id, lotNumber: lot.lotNumber, lotDate: lot.lotDate.toISOString().split("T")[0],
      status: lot.status, notes: lot.notes,
      pkrExchangeRate: lot.pkrExchangeRate ? Number(lot.pkrExchangeRate) : null,
      country: { id: lot.country.id, name: lot.country.name, code: lot.country.code },
      createdBy: lot.creator,
      products: stockByProduct,
      distributions,
      purchaseItems: lotPurchases.map((p: any) => ({
        id: p.id,
        supplierId: p.supplierId,
        supplierName: p.supplier?.name || "",
        productId: p.productId,
        productName: p.product?.name || "",
        qtyMt: Number(p.qty),
        weightPerCartonKg: p.weightPerCartonKg ? Number(p.weightPerCartonKg) : null,
        unitPriceUsdPerMt: Number(p.unitPriceUsd),
        totalPriceUsd: Number(p.totalPriceUsd),
      })),
      costSummary: {
        totalPurchaseUsd: Math.round(totalPurchaseUsd * 100) / 100,
        costsByCurrency,
        totalLotExpenses: totalExpenses,
        lotExpensesByCurrency,
        costBreakdown,
      },
      stockSummary: { totalCartons, soldCartons, remainingCartons, byProduct: stockByProduct },
      summary: { totalSales, totalPayments, totalExpenses, totalHaji, outstanding: totalSales - totalPayments },
      recentSales: sales.map((s: any) => ({ ...s, totalAmount: Number(s.totalAmount), saleDate: s.saleDate.toISOString().split("T")[0] })),
      recentPayments: payments.map((p: any) => ({ ...p, amount: Number(p.amount), paymentDate: p.paymentDate.toISOString().split("T")[0] })),
      expenses: expenses.map((e: any) => ({ ...e, amount: Number(e.amount), expenseDate: e.expenseDate.toISOString().split("T")[0] })),
      hajiTransfers: hajiTransfers.map((h: any) => ({ ...h, amount: Number(h.amount), transferDate: h.transferDate.toISOString().split("T")[0] })),
      auditTimeline,
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
            const productName = (await prisma.product.findUnique({ where: { id: p.productId }, select: { name: true } }))?.name ?? `Product #${p.productId}`;
            return errorResponse("VALIDATION_ERROR", `"${productName}": new qty ${p.totalQty} is less than already-distributed ${allocatedTotal} cartons. Update distributions first.`);
          }
          await prisma.lotProduct.update({ where: { id: existing.id }, data: { totalQty: p.totalQty } });
        } else {
          await prisma.lotProduct.create({ data: { lotId: id, productId: p.productId, totalQty: p.totalQty } });
        }
      }
    }

    await createAuditLog(user.userId, null, "lots", id, "update", { lotNumber: lot.lotNumber, notes: lot.notes }, { lotNumber: updated.lotNumber, notes: updated.notes }, getClientIP(request));
    return successResponse({ id: updated.id, lotNumber: updated.lotNumber }, "Lot updated");
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
    // Delete all related data atomically — if any step fails the lot is NOT deleted
    await prisma.$transaction(async (tx) => {
      await tx.lotCityGodownAllocation.deleteMany({ where: { lotCityDistribution: { lotId: id } } });
      await tx.lotCityDistribution.deleteMany({ where: { lotId: id } });
      await tx.lotProduct.deleteMany({ where: { lotId: id } });
      await tx.lotCost.deleteMany({ where: { lotId: id } });
      await tx.lotPurchase.deleteMany({ where: { lotId: id } });
      await tx.expense.deleteMany({ where: { lotId: id } });
      await tx.hajiTransfer.deleteMany({ where: { lotId: id } });
      await tx.lot.delete({ where: { id } });
    });
    await createAuditLog(user.userId, null, "lots", id, "delete", { lotNumber: lot.lotNumber }, undefined, getClientIP(request));
    return successResponse({ id }, "Lot deleted");
  } catch (error: any) {
    console.error("Delete lot error:", error?.message);
    return serverError();
  }
});
