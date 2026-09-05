import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { successResponse, errorResponse, serverError, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { buildLotCostLedger } from "@/lib/lot-cost-ledger";
import { computeLotLandedCostPkr } from "@/lib/landed-cost-pkr";
import { buildCityLotAssignmentDetail } from "@/lib/city-lot-assignment";
import { updateLotSchema } from "@/lib/validations";
import {
  buildLotPurchasePkrBasis,
  journalLotPurchase,
  lotPurchaseJournalTransactionId,
  reverseJournalEntries,
} from "@/lib/accounting";
import { LOT_SHIPMENT_STATUS_VALUES, lotDocumentCategoryLabel, lotShipmentStatusLabel } from "@/lib/lot-documents";
import { buildLotStockTrace } from "@/lib/accounting-traceability";

const round2 = (n: number) => Math.round(n * 100) / 100;

type ProductUnitMeta = {
  id: number;
  name: string;
  unitOfMeasure: "MT" | "PCS";
  defaultWeightPerCartonKg: any;
  piecesPerCarton: number | null;
};

function cartonsFromPurchase(qtyMt: number, weightPerCartonKg: number) {
  if (weightPerCartonKg <= 0 || qtyMt <= 0) return 0;
  return Math.round((qtyMt * 1000) / weightPerCartonKg);
}

function stockQtyFromPurchase(item: any, product: ProductUnitMeta) {
  if (product.unitOfMeasure === "PCS") return Number(item.qtyPcs || 0);
  return cartonsFromPurchase(Number(item.qtyMt || 0), Number(product.defaultWeightPerCartonKg || 0));
}

function purchaseQtyAndPrice(item: any, product: ProductUnitMeta) {
  const purchaseQty = product.unitOfMeasure === "PCS" ? Number(item.qtyPcs || 0) : Number(item.qtyMt || 0);
  const unitPriceUsd = product.unitOfMeasure === "PCS" ? Number(item.unitPriceUsdPerPcs || 0) : Number(item.unitPriceUsdPerMt || 0);
  return { purchaseQty, unitPriceUsd };
}

function toDisplayStockQty(qty: number, product: { unitOfMeasure?: string | null; piecesPerCarton?: number | null }) {
  const piecesPerCarton = Number(product.piecesPerCarton || 0);
  if (product.unitOfMeasure === "PCS" && piecesPerCarton > 0) {
    return round2(qty / piecesPerCarton);
  }
  return round2(qty);
}

function productCartonsFromItems(items: any[], productById: Map<number, ProductUnitMeta>) {
  const totals: Record<number, number> = {};
  for (const item of items) {
    const product = productById.get(item.productId);
    if (!product) continue;
    const stockQty = stockQtyFromPurchase(item, product);
    totals[item.productId] = (totals[item.productId] || 0) + stockQty;
  }
  return totals;
}

export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);

    if (user.role === "city_admin") {
      if (!user.cityId) return errorResponse("FORBIDDEN", "City scope required", 403);
      const result = await buildCityLotAssignmentDetail(id, user.cityId);
      if (!result.ok) {
        if (result.reason === "not_found") return errorResponse("NOT_FOUND", "Lot not found", 404);
        return errorResponse("FORBIDDEN", "This lot is not assigned to your city", 403);
      }
      return successResponse(result.data);
    }

    const lot = await prisma.lot.findUnique({
      where: { id },
      include: {
        country: true,
        consignee: { select: { id: true, name: true, phone: true, address: true, notes: true, isActive: true } },
        destinationCity: { select: { id: true, name: true } },
        creator: { select: { id: true, fullName: true } },
      },
    }) as any;
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    // Separate safe queries
    let lotProducts: any[] = [];
    try { lotProducts = await prisma.lotProduct.findMany({ where: { lotId: id }, include: { product: true } }); } catch (e) {}

    let distributions: any[] = [];
    try {
      const dists = await prisma.lotCityDistribution.findMany({
        where: { lotId: id },
        include: { city: true, product: true, godownAllocations: { include: { godown: true } } },
      });
      distributions = dists.map((d: any) => ({
        cityId: d.cityId, cityName: d.city.name, productId: d.productId, productName: d.product.name,
        unitOfMeasure: d.product.unitOfMeasure,
        piecesPerCarton: d.product.piecesPerCarton,
        allocatedQty: Number(d.allocatedQty),
        displayAllocatedQty: toDisplayStockQty(Number(d.allocatedQty), d.product),
        godownAllocations: d.godownAllocations.map((ga: any) => ({
          godownId: ga.godownId,
          godownName: ga.godown.name,
          qty: Number(ga.qty),
          displayQty: toDisplayStockQty(Number(ga.qty), d.product),
        })),
      }));
    } catch (e) {}

    let sales: any[] = [], payments: any[] = [], expenses: any[] = [], hajiTransfers: any[] = [];
    try { sales = await prisma.sale.findMany({ where: { OR: [{ lotId: id }, { items: { some: { lotId: id } } }], status: { in: ["active", "marked_short"] } }, select: { id: true, voucherNo: true, totalAmount: true, saleDate: true, status: true, isOpeningImport: true, fxOriginalCurrencyCode: true, fxOriginalAmount: true, fxSelectedRate: true, fxSelectedRateType: true, fxProvider: true, fxProviderReference: true, fxPkrEquivalent: true, fxConversionPathJson: true, customer: { select: { id: true, name: true } }, city: { select: { id: true, name: true } }, godown: { select: { id: true, name: true } }, currency: { select: { code: true } }, discounts: { where: { appliedToLotId: id }, select: { id: true, discountAmount: true, discountDate: true, notes: true, currency: { select: { code: true } } } }, items: { where: { lotId: id }, select: { lotId: true, qty: true, cartonQty: true, ratePerCarton: true, amount: true, product: { select: { id: true, name: true, unitOfMeasure: true, piecesPerCarton: true } } } } }, orderBy: { saleDate: "desc" } }); } catch (e) {}
    try { payments = await prisma.payment.findMany({ where: { lotId: id, status: "active" }, select: { id: true, amount: true, paymentDate: true, detail: true, customer: { select: { name: true } } }, orderBy: { paymentDate: "desc" }, take: 100 }); } catch (e) {}
    try { expenses = await prisma.expense.findMany({ where: { lotId: id, deletedAt: null }, select: { id: true, amount: true, detail: true, expenseDate: true, currency: { select: { code: true } } }, orderBy: { expenseDate: "desc" } }); } catch (e) {}
    try { hajiTransfers = await prisma.hajiTransfer.findMany({ where: { lotId: id }, select: { id: true, amount: true, detail: true, transferDate: true, transferType: true }, orderBy: { transferDate: "desc" } }); } catch (e) {}
    let documents: any[] = [], statusHistory: any[] = [];
    try {
      documents = await prisma.lotDocument.findMany({
        where: { lotId: id, archivedAt: null },
        include: { uploader: { select: { id: true, fullName: true } } },
        orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
      });
    } catch (e) {}
    try {
      statusHistory = await prisma.lotStatusHistory.findMany({
        where: { lotId: id },
        include: { changer: { select: { id: true, fullName: true } } },
        orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
      });
    } catch (e) {}

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
          createdAt: true,
          paidFromCash: true,
          supplierId: true,
          bankAccountId: true,
          superAdminBankAccountId: true,
          intermediaryId: true,
          agentId: true,
          shippingLineId: true,
          supplier: { select: { id: true, name: true } },
          bankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          superAdminBankAccount: { select: { id: true, bankName: true, accountNumber: true } },
          intermediary: { select: { id: true, name: true } },
          agent: { select: { id: true, name: true, agentType: true } },
          shippingLine: { select: { id: true, name: true } },
        },
      });
    } catch (e) {}
    try {
      lotPurchases = await prisma.lotPurchase.findMany({
        where: { lotId: id },
        include: {
          supplier: { select: { id: true, name: true } },
          product: { select: { id: true, name: true, unitOfMeasure: true, defaultWeightPerCartonKg: true, piecesPerCarton: true } },
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

    const totalSales = sales.reduce((sum: number, sale: any) => (
      sum + (sale.items || []).reduce((itemSum: number, item: any) => itemSum + Number(item.amount || 0), 0)
    ), 0);
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
      const cappedSoldQty = Math.min(totalQty, soldQty);
      const remainingQty = Math.max(0, totalQty - soldQty);
      return {
        productId: lp.productId,
        productName: lp.product.name,
        unitOfMeasure: lp.product.unitOfMeasure,
        defaultWeightPerCartonKg: lp.product.defaultWeightPerCartonKg ? Number(lp.product.defaultWeightPerCartonKg) : null,
        piecesPerCarton: lp.product.piecesPerCarton,
        totalQty,
        soldQty: cappedSoldQty,
        remainingQty,
        displayTotalQty: toDisplayStockQty(totalQty, lp.product),
        displaySoldQty: toDisplayStockQty(cappedSoldQty, lp.product),
        displayRemainingQty: toDisplayStockQty(remainingQty, lp.product),
      };
    });
    const totalCartons = stockByProduct.reduce((s: number, p: any) => s + Number(p.displayTotalQty), 0);
    const soldCartons = stockByProduct.reduce((s: number, p: any) => s + Number(p.displaySoldQty), 0);
    const remainingCartons = stockByProduct.reduce((s: number, p: any) => s + Number(p.displayRemainingQty), 0);

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
      } else if (c.supplierId) {
        debitChannel = "supplier";
        debitChannelLabel = `Supplier: ${c.supplier?.name || `#${c.supplierId}`}`;
      } else if (c.agentId) {
        const isCustomAgent = String(c.agent?.agentType || "").toLowerCase() === "customs";
        debitChannel = isCustomAgent ? "custom_agent" : "clearing_agent";
        debitChannelLabel = `${isCustomAgent ? "Custom Agent" : "Clearing Agent"}: ${c.agent?.name || `#${c.agentId}`}`;
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

    const supplierIds = Array.from(new Set(lotPurchases.map((p: any) => Number(p.supplierId)).filter(Boolean)));
    const supplierPaymentsForLot = supplierIds.length
      ? await prisma.supplierPayment.findMany({
          where: { lotId: id, supplierId: { in: supplierIds }, deletedAt: null },
          select: {
            id: true,
            amountUsd: true,
            exchangeRate: true,
            amountLocal: true,
            carryingRatePkr: true,
            carryingAmountPkr: true,
            realizedFxPkr: true,
            paymentDate: true,
            paymentMethod: true,
            reference: true,
            notes: true,
            supplier: { select: { id: true, name: true } },
            intermediary: { select: { id: true, name: true } },
          },
          orderBy: { paymentDate: "asc" },
        })
      : [];

    const [shippingPaymentsForLot, openingValuations, godownTransfers, cityTransfers] = await Promise.all([
      prisma.shippingLinePayment.findMany({
        where: { lotId: id, deletedAt: null },
        select: {
          id: true,
          amountUsd: true,
          exchangeRate: true,
          amountPkr: true,
          carryingRatePkr: true,
          carryingAmountPkr: true,
          realizedFxPkr: true,
          paymentDate: true,
          reference: true,
          notes: true,
          shippingLine: { select: { id: true, name: true } },
          intermediary: { select: { id: true, name: true } },
        },
        orderBy: { paymentDate: "asc" },
      }),
      prisma.openingInventoryValuation.findMany({
        where: { lotId: id },
        select: { productId: true, unitCostPkr: true, totalValuePkr: true, originalAmount: true, fxRateToPkr: true, fxRateDate: true, fxRateSource: true, fxRateMetadata: true },
      }),
      prisma.godownTransfer.findMany({
        where: { lotId: id },
        select: { id: true, productId: true, qty: true, transferDate: true, fromGodown: { select: { name: true } }, toGodown: { select: { name: true } } },
        orderBy: { transferDate: "asc" },
      }),
      prisma.cityTransfer.findMany({
        where: { lotId: id },
        select: { id: true, productId: true, qty: true, status: true, transferDate: true, fromCity: { select: { name: true } }, toCity: { select: { name: true } } },
        orderBy: { transferDate: "asc" },
      }),
    ]);

    const supplierPaymentIds = supplierPaymentsForLot.map((payment) => payment.id);
    const shippingPaymentIds = shippingPaymentsForLot.map((payment) => payment.id);
    const saleIds = sales.map((sale: any) => sale.id);
    const discountIds = sales.flatMap((sale: any) => sale.discounts.map((discount: any) => discount.id));
    const traceJournals = await prisma.journalEntry.findMany({
      where: {
        OR: [
          { lotId: id },
          ...(saleIds.length ? [{ entityType: "sale", entityId: { in: saleIds } }] : []),
          ...(supplierPaymentIds.length ? [{ entityType: "supplier_payment", entityId: { in: supplierPaymentIds } }] : []),
          ...(shippingPaymentIds.length ? [{ entityType: "shipping_line_payment", entityId: { in: shippingPaymentIds } }] : []),
          ...(discountIds.length ? [{ entityType: "sale_discount", entityId: { in: discountIds } }] : []),
        ],
      },
      include: { account: { select: { code: true, name: true, accountType: true } } },
      orderBy: [{ entryDate: "asc" }, { transactionId: "asc" }, { lineNumber: "asc" }],
    });

    const ledgerBuilt = buildLotCostLedger({
      lotDate: lot.lotDate.toISOString().split("T")[0],
      lotCountryCode: lot.country?.code || "",
      usdPkrRate: Number(lot.pkrExchangeRate || 0),
      purchaseItems: lotPurchases.map((p: any) => ({
        id: p.id,
        supplierName: p.supplier?.name || "",
        productName: p.product?.name || "",
        totalPriceUsd: Number(p.totalPriceUsd),
        createdAt: p.createdAt,
      })),
      lotCosts: costBreakdown.map((c: any) => ({
        id: c.id,
        costType: c.costType,
        description: c.description,
        amount: c.amount,
        currencyCode: c.currencyCode,
        exchangeRate: c.exchangeRate,
        costDate: c.costDate,
        createdAt: c.createdAt,
        debitChannelLabel: c.debitChannelLabel,
      })),
      lotExpensesByCurrency,
      supplierPaymentsForLot: supplierPaymentsForLot.map((p) => ({
        amountUsd: Number(p.amountUsd),
        exchangeRate: p.exchangeRate,
        paymentDate: p.paymentDate,
      })),
    });

    const landedCostPkr = lot.pkrExchangeRate
      ? computeLotLandedCostPkr({
          totalPurchaseUsd,
          totalCartons,
          lotCosts: lotCosts.map((c: any) => ({
            amount: c.amount,
            currencyCode: c.currencyCode,
            exchangeRate: c.exchangeRate,
            costType: c.costType,
          })),
          lotExpensesByCurrency,
          usdPkrRate: Number(lot.pkrExchangeRate),
        })
      : null;

    const openingValuationByProduct = new Map(openingValuations.map((valuation) => [valuation.productId, valuation]));
    const additionalLandedCostPkr = ledgerBuilt.rows
      .filter((row) => row.sourceType !== "purchase")
      .reduce((sum, row) => sum + Number(row.amountPkr || 0), 0);
    const stockTrace = buildLotStockTrace({
      lotProducts: lotProducts.map((lotProduct: any) => ({
        productId: lotProduct.productId,
        productName: lotProduct.product.name,
        unitOfMeasure: lotProduct.product.unitOfMeasure,
        piecesPerCarton: lotProduct.product.piecesPerCarton,
        originalQty: Number(lotProduct.totalQty || 0),
        openingUnitCostPkr: openingValuationByProduct.get(lotProduct.productId)?.unitCostPkr
          ? Number(openingValuationByProduct.get(lotProduct.productId)!.unitCostPkr)
          : null,
      })),
      purchases: lotPurchases.map((purchase: any) => ({
        id: purchase.id,
        productId: purchase.productId,
        supplierName: purchase.supplier?.name || "",
        originalAmountUsd: Number(purchase.totalPriceUsd || 0),
        carryingAmountPkr: purchase.carryingAmountPkr == null ? null : Number(purchase.carryingAmountPkr),
      })),
      distributed: distributions.map((distribution: any) => ({ productId: distribution.productId, qty: Number(distribution.allocatedQty || 0) })),
      sales: sales.flatMap((sale: any) => sale.items.map((item: any) => ({ productId: item.product.id, qty: Number(item.qty || 0) }))),
      godownTransfers: godownTransfers.map((transfer) => ({ productId: transfer.productId, qty: Number(transfer.qty || 0) })),
      cityTransfers: cityTransfers.map((transfer) => ({ productId: transfer.productId, qty: Number(transfer.qty || 0), status: transfer.status })),
      additionalLandedCostPkr,
    });
    const journalRows = traceJournals.map((entry) => ({
      id: entry.id,
      transactionId: entry.transactionId,
      lineNumber: entry.lineNumber,
      entryDate: entry.entryDate.toISOString().split("T")[0],
      entityType: entry.entityType,
      entityId: entry.entityId,
      lotId: entry.lotId,
      cityId: entry.cityId,
      accountCode: entry.account.code,
      accountName: entry.account.name,
      accountType: entry.account.accountType,
      debit: Number(entry.debit),
      credit: Number(entry.credit),
      currencyCode: entry.currencyCode,
      exchangeRate: entry.exchangeRate == null ? null : Number(entry.exchangeRate),
      description: entry.description,
    }));
    const totalJournalDebits = journalRows.reduce((sum, entry) => sum + entry.debit, 0);
    const totalJournalCredits = journalRows.reduce((sum, entry) => sum + entry.credit, 0);
    const accountingTrace = {
      access: "super_admin",
      chain: ["P&L", "Revenue", "Sales", "Lot", "Product", "Cartons", "COGS", "Purchase / Import", "FX Basis", "Supplier Settlement", "FX Gain / Loss", "Journal"],
      fxRecognitionBasis: {
        currencyPair: "USD/PKR",
        rate: lot.pkrExchangeRate ? Number(lot.pkrExchangeRate) : null,
        metadata: (lot as any).pkrExchangeRateMetadata || null,
        recognitionDate: lot.lotDate.toISOString().split("T")[0],
      },
      stock: stockTrace,
      purchases: lotPurchases.map((purchase: any) => ({
        id: purchase.id,
        supplier: purchase.supplier?.name || "—",
        productId: purchase.productId,
        product: purchase.product?.name || "—",
        quantity: Number(purchase.qty || 0),
        originalAmountUsd: Number(purchase.totalPriceUsd || 0),
        carryingRatePkr: purchase.carryingRatePkr == null ? null : Number(purchase.carryingRatePkr),
        carryingAmountPkr: purchase.carryingAmountPkr == null ? null : Number(purchase.carryingAmountPkr),
        recognitionDate: purchase.recognitionDate?.toISOString().split("T")[0] || lot.lotDate.toISOString().split("T")[0],
        recognitionRateMetadata: purchase.recognitionRateMetadata || null,
        journalTransactionIds: journalRows.filter((entry) => entry.entityType === "lot_purchase" && entry.entityId === purchase.id).map((entry) => entry.transactionId).filter((value, index, rows) => rows.indexOf(value) === index),
      })),
      sales: sales.map((sale: any) => {
        const nativeLotAmount = sale.items.reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0);
        const saleNativeAmount = Number(sale.totalAmount || 0);
        const recognizedPkr = String(sale.currency.code).toUpperCase() === "PKR"
          ? nativeLotAmount
          : sale.fxPkrEquivalent == null || saleNativeAmount === 0
          ? null
          : Number(sale.fxPkrEquivalent) * (nativeLotAmount / saleNativeAmount);
        const saleDiscountIds = sale.discounts.map((discount: any) => discount.id);
        const unsupportedDiscountCurrency = sale.discounts.some((discount: any) => String(discount.currency.code).toUpperCase() !== "PKR");
        const discountPkr = unsupportedDiscountCurrency
          ? null
          : sale.discounts.reduce((sum: number, discount: any) => sum + Number(discount.discountAmount || 0), 0);
        const netRecognizedRevenuePkr = recognizedPkr == null || discountPkr == null ? null : recognizedPkr - discountPkr;
        const saleJournals = journalRows.filter((entry) => entry.transactionId === `SALE-${sale.id}`);
        const lotCogsJournals = journalRows.filter((entry) => entry.transactionId === `COGS-${sale.id}` && entry.lotId === id);
        const discountJournals = journalRows.filter((entry) => entry.entityType === "sale_discount" && saleDiscountIds.includes(Number(entry.entityId)));
        const relatedJournals = [...saleJournals, ...lotCogsJournals, ...discountJournals];
        const cogsPkr = lotCogsJournals
          .filter((entry) => entry.accountType === "cogs")
          .reduce((sum, entry) => sum + entry.debit - entry.credit, 0);
        const hasSaleJournal = saleJournals.length > 0;
        const hasCogsJournal = lotCogsJournals.length > 0;
        const blockers = [
          ...(String(sale.currency.code).toUpperCase() !== "PKR" && recognizedPkr == null ? ["Foreign sale lacks stored PKR recognition metadata"] : []),
          ...(unsupportedDiscountCurrency ? ["Foreign-currency discount lacks stored PKR recognition metadata"] : []),
          ...(!sale.isOpeningImport && !hasSaleJournal ? ["Missing SALE journal"] : []),
          ...(!sale.isOpeningImport && !hasCogsJournal ? ["Missing COGS journal"] : []),
        ];
        return {
          id: sale.id,
          voucherNo: sale.voucherNo,
          saleDate: sale.saleDate.toISOString().split("T")[0],
          city: sale.city.name,
          customer: sale.customer.name,
          godown: sale.godown.name,
          currency: sale.currency.code,
          originalAmount: nativeLotAmount,
          recognizedRevenuePkr: netRecognizedRevenuePkr == null ? null : round2(netRecognizedRevenuePkr),
          fxRate: sale.fxSelectedRate == null ? null : Number(sale.fxSelectedRate),
          fxRateType: sale.fxSelectedRateType,
          fxProvider: sale.fxProvider,
          fxProviderReference: sale.fxProviderReference,
          fxConversionPath: sale.fxConversionPathJson,
          discounts: sale.discounts.map((discount: any) => ({ id: discount.id, amount: Number(discount.discountAmount), currency: discount.currency.code, date: discount.discountDate.toISOString().split("T")[0], notes: discount.notes })),
          cogsPkr: round2(cogsPkr),
          grossProfitPkr: netRecognizedRevenuePkr == null ? null : round2(netRecognizedRevenuePkr - cogsPkr),
          blockers,
          items: sale.items.map((item: any) => ({ productId: item.product.id, product: item.product.name, quantity: toDisplayStockQty(Number(item.qty || 0), item.product), originalAmount: Number(item.amount || 0) })),
          journalTransactionIds: relatedJournals.map((entry) => entry.transactionId).filter((value, index, rows) => rows.indexOf(value) === index),
        };
      }),
      supplierSettlements: supplierPaymentsForLot.map((payment) => ({
        id: payment.id,
        supplier: payment.supplier.name,
        paymentDate: payment.paymentDate.toISOString().split("T")[0],
        amountUsd: Number(payment.amountUsd),
        carryingRatePkr: payment.carryingRatePkr == null ? null : Number(payment.carryingRatePkr),
        carryingAmountPkr: payment.carryingAmountPkr == null ? null : Number(payment.carryingAmountPkr),
        settlementRatePkr: payment.exchangeRate == null ? null : Number(payment.exchangeRate),
        settlementAmountPkr: payment.amountLocal == null ? null : Number(payment.amountLocal),
        realizedFxPkr: payment.realizedFxPkr == null ? null : Number(payment.realizedFxPkr),
        paymentMethod: payment.paymentMethod,
        source: payment.intermediary?.name || null,
        reference: payment.reference,
        journalTransactionIds: journalRows.filter((entry) => entry.entityType === "supplier_payment" && entry.entityId === payment.id).map((entry) => entry.transactionId).filter((value, index, rows) => rows.indexOf(value) === index),
      })),
      shippingSettlements: shippingPaymentsForLot.map((payment) => ({
        id: payment.id,
        shippingLine: payment.shippingLine.name,
        paymentDate: payment.paymentDate.toISOString().split("T")[0],
        amountUsd: Number(payment.amountUsd),
        carryingRatePkr: payment.carryingRatePkr == null ? null : Number(payment.carryingRatePkr),
        carryingAmountPkr: payment.carryingAmountPkr == null ? null : Number(payment.carryingAmountPkr),
        settlementRatePkr: payment.exchangeRate == null ? null : Number(payment.exchangeRate),
        settlementAmountPkr: payment.amountPkr == null ? null : Number(payment.amountPkr),
        realizedFxPkr: payment.realizedFxPkr == null ? null : Number(payment.realizedFxPkr),
        source: payment.intermediary?.name || null,
        reference: payment.reference,
        journalTransactionIds: journalRows.filter((entry) => entry.entityType === "shipping_line_payment" && entry.entityId === payment.id).map((entry) => entry.transactionId).filter((value, index, rows) => rows.indexOf(value) === index),
      })),
      transfers: {
        godown: godownTransfers.map((transfer) => ({ id: transfer.id, productId: transfer.productId, quantity: Number(transfer.qty), date: transfer.transferDate.toISOString().split("T")[0], from: transfer.fromGodown.name, to: transfer.toGodown.name })),
        city: cityTransfers.map((transfer) => ({ id: transfer.id, productId: transfer.productId, quantity: Number(transfer.qty), status: transfer.status, date: transfer.transferDate.toISOString().split("T")[0], from: transfer.fromCity.name, to: transfer.toCity.name })),
      },
      journals: journalRows,
      reconciliation: {
        totalDebits: round2(totalJournalDebits),
        totalCredits: round2(totalJournalCredits),
        difference: round2(totalJournalDebits - totalJournalCredits),
      },
    };

    return successResponse({
      id: lot.id, lotNumber: lot.lotNumber, lotDate: lot.lotDate.toISOString().split("T")[0],
      status: lot.status, isLegacyStock: lot.isLegacyStock, notes: lot.notes,
      shipmentStatus: lot.shipmentStatus,
      shipmentStatusLabel: lotShipmentStatusLabel(lot.shipmentStatus),
      etaDate: lot.etaDate ? lot.etaDate.toISOString().split("T")[0] : null,
      pkrExchangeRate: lot.pkrExchangeRate ? Number(lot.pkrExchangeRate) : null,
      pkrExchangeRateMetadata: (lot as any).pkrExchangeRateMetadata || null,
      country: { id: lot.country.id, name: lot.country.name, code: lot.country.code },
      consignee: lot.consignee,
      destinationCity: lot.destinationCity,
      createdBy: lot.creator,
      products: stockByProduct,
      distributions,
      purchaseItems: lotPurchases.map((p: any) => ({
        id: p.id,
        supplierId: p.supplierId,
        supplierName: p.supplier?.name || "",
        productId: p.productId,
        productName: p.product?.name || "",
        unitOfMeasure: p.product?.unitOfMeasure || "MT",
        defaultWeightPerCartonKg: p.product?.defaultWeightPerCartonKg ? Number(p.product.defaultWeightPerCartonKg) : null,
        piecesPerCarton: p.product?.piecesPerCarton || null,
        qtyMt: p.product?.unitOfMeasure === "PCS" ? null : Number(p.qty),
        qtyPcs: p.product?.unitOfMeasure === "PCS" ? Number(p.qty) : null,
        weightPerCartonKg: p.weightPerCartonKg ? Number(p.weightPerCartonKg) : null,
        unitPriceUsdPerMt: p.product?.unitOfMeasure === "PCS" ? null : Number(p.unitPriceUsd),
        unitPriceUsdPerPcs: p.product?.unitOfMeasure === "PCS" ? Number(p.unitPriceUsd) : null,
        totalPriceUsd: Number(p.totalPriceUsd),
      })),
      costSummary: {
        totalPurchaseUsd: Math.round(totalPurchaseUsd * 100) / 100,
        costsByCurrency,
        totalLotExpenses: totalExpenses,
        lotExpensesByCurrency,
        costBreakdown,
        otherCostsByCurrency: ledgerBuilt.costSummary.otherCostsByCurrency,
        totalLandedCostPkr: ledgerBuilt.costSummary.totalLandedCostPkr,
        landedCostPerCartonPkr: landedCostPkr?.landedCostPerCartonPkr ?? null,
      },
      costLedger: ledgerBuilt.rows,
      stockSummary: { totalCartons, soldCartons, remainingCartons, byProduct: stockByProduct },
      summary: { totalSales, totalPayments, totalExpenses, totalHaji, outstanding: totalSales - totalPayments },
      recentSales: sales.map((s: any) => ({
        ...s,
        totalAmount: (s.items || []).reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0),
        saleDate: s.saleDate.toISOString().split("T")[0],
      })),
      recentPayments: payments.map((p: any) => ({ ...p, amount: Number(p.amount), paymentDate: p.paymentDate.toISOString().split("T")[0] })),
      expenses: expenses.map((e: any) => ({ ...e, amount: Number(e.amount), expenseDate: e.expenseDate.toISOString().split("T")[0] })),
      hajiTransfers: hajiTransfers.map((h: any) => ({ ...h, amount: Number(h.amount), transferDate: h.transferDate.toISOString().split("T")[0] })),
      documents: documents.map((d: any) => ({
        id: d.id,
        category: d.category,
        categoryLabel: lotDocumentCategoryLabel(d.category),
        originalFileName: d.originalFileName,
        downloadUrl: `/api/v1/lots/${id}/documents/${d.id}/download`,
        mimeType: d.mimeType,
        extension: d.extension,
        fileSize: d.fileSize,
        referenceNo: d.referenceNo,
        documentDate: d.documentDate ? d.documentDate.toISOString().split("T")[0] : null,
        note: d.note,
        uploadedBy: d.uploader ? { id: d.uploader.id, fullName: d.uploader.fullName } : null,
        uploadedAt: d.uploadedAt.toISOString(),
      })),
      documentsCount: documents.length,
      statusHistory: statusHistory.map((h: any) => ({
        id: h.id,
        previousStatus: h.previousStatus,
        previousStatusLabel: lotShipmentStatusLabel(h.previousStatus),
        newStatus: h.newStatus,
        newStatusLabel: lotShipmentStatusLabel(h.newStatus),
        effectiveAt: h.effectiveAt.toISOString(),
        location: h.location,
        note: h.note,
        changedBy: h.changer ? { id: h.changer.id, fullName: h.changer.fullName } : null,
        createdAt: h.createdAt.toISOString(),
      })),
      auditTimeline,
      accountingTrace,
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
    const parsed = updateLotSchema.safeParse(body);
    if (!parsed.success) return validationError("Invalid lot data", parsed.error.errors);

    const lot = await prisma.lot.findUnique({ where: { id } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
    if (lot.isLegacyStock) {
      return errorResponse("VALIDATION_ERROR", "Use Openings → Legacy stock to manage the OLD-STOCK lot", 400);
    }

    const data = parsed.data;
    if (data.shipmentStatus && !LOT_SHIPMENT_STATUS_VALUES.includes(data.shipmentStatus as any)) {
      return validationError("Invalid shipment status");
    }
    const nextCountryId = data.countryId ?? lot.countryId;
    const nextLotNumber = data.lotNumber ?? lot.lotNumber;
    const nextConsigneeId = data.consigneeId === undefined ? lot.consigneeId : data.consigneeId || null;
    const nextDestinationCityId = data.destinationCityId === undefined ? lot.destinationCityId : data.destinationCityId || null;
    const nextShipmentStatus = (data.shipmentStatus ?? lot.shipmentStatus) as any;
    const nextEtaDate = data.etaDate === undefined ? lot.etaDate : data.etaDate ? new Date(data.etaDate) : null;
    if (nextConsigneeId) {
      const consignee = await prisma.consignee.findUnique({ where: { id: nextConsigneeId } });
      if (!consignee) return errorResponse("NOT_FOUND", "Consignee not found", 404);
    }
    if (nextDestinationCityId) {
      const destination = await prisma.city.findUnique({ where: { id: nextDestinationCityId } });
      if (!destination || destination.countryId !== nextCountryId) return validationError("Destination city must belong to selected country");
    }

    if (nextCountryId !== lot.countryId) {
      const distCount = await prisma.lotCityDistribution.count({ where: { lotId: id } });
      if (distCount > 0) {
        return errorResponse("VALIDATION_ERROR", "Remove city distributions before changing country", 400);
      }
    }

    if (nextLotNumber !== lot.lotNumber || nextCountryId !== lot.countryId) {
      const duplicate = await prisma.lot.findUnique({
        where: { countryId_lotNumber: { countryId: nextCountryId, lotNumber: nextLotNumber } },
      });
      if (duplicate && duplicate.id !== id) {
        return errorResponse("DUPLICATE", `Lot number ${nextLotNumber} already exists for this country`, 409);
      }
    }

    if (data.purchaseItems) {
      const productIds = Array.from(new Set(data.purchaseItems.map((p) => p.productId)));
      const supplierIds = Array.from(new Set(data.purchaseItems.map((p) => p.supplierId)));
      const [products, suppliers] = await Promise.all([
        prisma.product.findMany({ where: { id: { in: productIds }, isActive: true } }),
        prisma.supplier.findMany({ where: { id: { in: supplierIds }, isActive: true } }),
      ]);
      if (products.length !== productIds.length) {
        return errorResponse("NOT_FOUND", "One or more products not found or inactive");
      }
      if (suppliers.length !== supplierIds.length) {
        return errorResponse("NOT_FOUND", "One or more suppliers not found or inactive");
      }

      const productById = new Map(products.map((p) => [p.id, p as ProductUnitMeta]));
      for (const item of data.purchaseItems) {
        const product = productById.get(item.productId);
        if (!product) continue;
        if (product.unitOfMeasure === "PCS") {
          if (!product.piecesPerCarton) return errorResponse("VALIDATION_ERROR", `${product.name}: PCS/CTN is required on product master`);
          if (!item.qtyPcs || !item.unitPriceUsdPerPcs) return errorResponse("VALIDATION_ERROR", `${product.name}: QTY (PCS) and USD/PCS are required`);
        } else {
          if (!product.defaultWeightPerCartonKg) return errorResponse("VALIDATION_ERROR", `${product.name}: WT/CRT (KG) is required on product master`);
          if (!item.qtyMt || !item.unitPriceUsdPerMt) return errorResponse("VALIDATION_ERROR", `${product.name}: QTY (MT) and USD/MT are required`);
        }
      }

      const productCartons = productCartonsFromItems(data.purchaseItems, productById);

      for (const [productId, totalQty] of Object.entries(productCartons)) {
        const distTotal = await prisma.lotCityDistribution.aggregate({
          where: { lotId: id, productId: Number(productId) },
          _sum: { allocatedQty: true },
        });
        const allocatedTotal = Number(distTotal._sum.allocatedQty || 0);
        if (allocatedTotal > totalQty) {
          const productName = products.find((p) => p.id === Number(productId))?.name ?? `Product #${productId}`;
          return errorResponse(
            "VALIDATION_ERROR",
            `"${productName}": ${totalQty} cartons is less than already-distributed ${allocatedTotal}. Update distributions first.`,
          );
        }
      }

      await prisma.$transaction(async (tx) => {
        await tx.lot.update({
          where: { id },
          data: {
            countryId: nextCountryId,
            consigneeId: nextConsigneeId,
            destinationCityId: nextDestinationCityId,
            lotNumber: nextLotNumber,
            lotDate: data.lotDate ? new Date(data.lotDate) : lot.lotDate,
            shipmentStatus: nextShipmentStatus,
            etaDate: nextEtaDate,
            notes: data.notes !== undefined ? data.notes : lot.notes,
            updatedAt: new Date(),
          },
        });
        if (nextShipmentStatus !== lot.shipmentStatus) {
          await tx.lotStatusHistory.create({
            data: {
              lotId: id,
              previousStatus: lot.shipmentStatus,
              newStatus: nextShipmentStatus,
              effectiveAt: new Date(),
              note: "Shipment status updated from lot edit",
              changedBy: user.userId,
            },
          });
        }

        const existingPurchases = await tx.lotPurchase.findMany({ where: { lotId: id } });
        const incomingIds = new Set(
          data.purchaseItems!.map((p) => p.id).filter((purchaseId): purchaseId is number => Boolean(purchaseId)),
        );

        if (data.purchaseItems!.length < 1) {
          throw new Error("Cannot delete the only purchase item in a lot");
        }

        for (const existing of existingPurchases) {
          if (incomingIds.has(existing.id)) continue;
          await reverseJournalEntries(lotPurchaseJournalTransactionId(existing.lotId, existing.id, existing.journalVersion), user.userId, tx);
          await tx.lotPurchase.delete({ where: { id: existing.id } });
        }

        for (const item of data.purchaseItems!) {
          const product = productById.get(item.productId)!;
          const { purchaseQty, unitPriceUsd } = purchaseQtyAndPrice(item, product);
          const totalPriceUsd = round2(purchaseQty * unitPriceUsd);
          if (item.id) {
            const existing = existingPurchases.find((row) => row.id === item.id);
            if (!existing) throw new Error(`Purchase item #${item.id} not found on this lot`);
            const carryingRatePkr = Number(existing.carryingRatePkr || lot.pkrExchangeRate || 0);
            const basis = buildLotPurchasePkrBasis({ totalUsd: totalPriceUsd, carryingRatePkr });
            await reverseJournalEntries(lotPurchaseJournalTransactionId(existing.lotId, existing.id, existing.journalVersion), user.userId, tx);
            const updatedPurchase = await tx.lotPurchase.update({
              where: { id: item.id },
              data: {
                supplierId: item.supplierId,
                productId: item.productId,
                qty: purchaseQty,
                weightPerCartonKg: product.unitOfMeasure === "PCS" ? null : product.defaultWeightPerCartonKg,
                unitPriceUsd,
                totalPriceUsd,
                carryingRatePkr: basis.carryingRatePkr,
                carryingAmountPkr: basis.carryingAmountPkr,
                recognitionDate: existing.recognitionDate || lot.lotDate,
                recognitionRateMetadata: existing.recognitionRateMetadata || lot.pkrExchangeRateMetadata as any,
                journalVersion: { increment: 1 },
              },
            });
            await journalLotPurchase(
              {
                id: item.id, supplierId: item.supplierId, lotId: id, totalUsd: totalPriceUsd,
                carryingRatePkr: basis.carryingRatePkr, carryingAmountPkr: basis.carryingAmountPkr,
                recognitionDate: updatedPurchase.recognitionDate || lot.lotDate,
                journalVersion: updatedPurchase.journalVersion, createdBy: user.userId,
              },
              tx,
            );
          } else {
            const basis = buildLotPurchasePkrBasis({ totalUsd: totalPriceUsd, carryingRatePkr: Number(lot.pkrExchangeRate || 0) });
            const purchase = await tx.lotPurchase.create({
              data: {
                lotId: id,
                supplierId: item.supplierId,
                productId: item.productId,
                qty: purchaseQty,
                weightPerCartonKg: product.unitOfMeasure === "PCS" ? null : product.defaultWeightPerCartonKg,
                unitPriceUsd,
                totalPriceUsd,
                carryingRatePkr: basis.carryingRatePkr,
                carryingAmountPkr: basis.carryingAmountPkr,
                recognitionDate: lot.lotDate,
                recognitionRateMetadata: lot.pkrExchangeRateMetadata as any,
                createdBy: user.userId,
              },
            });
            await journalLotPurchase(
              {
                id: purchase.id, supplierId: item.supplierId, lotId: id, totalUsd: totalPriceUsd,
                carryingRatePkr: basis.carryingRatePkr, carryingAmountPkr: basis.carryingAmountPkr,
                recognitionDate: lot.lotDate, journalVersion: purchase.journalVersion, createdBy: user.userId,
              },
              tx,
            );
          }
        }

        const nextProductIds = new Set(Object.keys(productCartons).map(Number));
        const currentProducts = await tx.lotProduct.findMany({ where: { lotId: id } });
        for (const row of currentProducts) {
          if (!nextProductIds.has(row.productId)) {
            await tx.lotProduct.delete({ where: { id: row.id } });
          }
        }
        for (const [productId, totalQty] of Object.entries(productCartons)) {
          await tx.lotProduct.upsert({
            where: { lotId_productId: { lotId: id, productId: Number(productId) } },
            create: { lotId: id, productId: Number(productId), totalQty },
            update: { totalQty },
          });
        }
      });
    } else {
      await prisma.lot.update({
        where: { id },
        data: {
          countryId: nextCountryId,
          consigneeId: nextConsigneeId,
          destinationCityId: nextDestinationCityId,
          lotNumber: nextLotNumber,
          lotDate: data.lotDate ? new Date(data.lotDate) : lot.lotDate,
          shipmentStatus: nextShipmentStatus,
          etaDate: nextEtaDate,
          notes: data.notes !== undefined ? data.notes : lot.notes,
          updatedAt: new Date(),
        },
      });
      if (nextShipmentStatus !== lot.shipmentStatus) {
        await prisma.lotStatusHistory.create({
          data: {
            lotId: id,
            previousStatus: lot.shipmentStatus,
            newStatus: nextShipmentStatus,
            effectiveAt: new Date(),
            note: "Shipment status updated from lot edit",
            changedBy: user.userId,
          },
        });
      }
    }

    const updated = await prisma.lot.findUnique({ where: { id }, select: { id: true, lotNumber: true } });
    await createAuditLog(
      user.userId,
      null,
      "lots",
      id,
      "update",
      { lotNumber: lot.lotNumber, notes: lot.notes, shipmentStatus: lot.shipmentStatus },
      { lotNumber: updated?.lotNumber, shipmentStatus: nextShipmentStatus, purchaseItemsUpdated: Boolean(data.purchaseItems) },
      getClientIP(request),
    );
    return successResponse({ id: updated?.id, lotNumber: updated?.lotNumber }, "Lot updated");
  } catch (error: any) {
    if (error?.message?.includes("only purchase item")) {
      return errorResponse("VALIDATION_ERROR", error.message, 400);
    }
    console.error("Update lot error:", error);
    return serverError();
  }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const lot = await prisma.lot.findUnique({ where: { id } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
    // Check if lot has sales
    const salesCount = await prisma.sale.count({ where: { status: "active", OR: [{ lotId: id }, { items: { some: { lotId: id } } }] } });
    if (salesCount > 0) return errorResponse("FORBIDDEN", `Cannot delete: lot has ${salesCount} active sales`, 403);
    // Delete all related data atomically — if any step fails the lot is NOT deleted
    await prisma.$transaction(async (tx) => {
      const [purchases, costs, expenses, transfers] = await Promise.all([
        tx.lotPurchase.findMany({ where: { lotId: id } }),
        tx.lotCost.findMany({ where: { lotId: id }, select: { id: true } }),
        tx.expense.findMany({ where: { lotId: id }, select: { id: true } }),
        tx.hajiTransfer.findMany({ where: { lotId: id }, select: { id: true } }),
      ]);
      for (const purchase of purchases) {
        await reverseJournalEntries(lotPurchaseJournalTransactionId(id, purchase.id, purchase.journalVersion), user.userId, tx);
      }
      for (const cost of costs) await reverseJournalEntries(`COST-${cost.id}`, user.userId, tx);
      for (const expense of expenses) await reverseJournalEntries(`EXP-${expense.id}`, user.userId, tx);
      for (const transfer of transfers) await reverseJournalEntries(`HAJI-${transfer.id}`, user.userId, tx);
      await tx.lotCityGodownAllocation.deleteMany({ where: { lotCityDistribution: { lotId: id } } });
      await tx.lotCityDistribution.deleteMany({ where: { lotId: id } });
      await tx.lotProduct.deleteMany({ where: { lotId: id } });
      await tx.lotCost.deleteMany({ where: { lotId: id } });
      await tx.lotPurchase.deleteMany({ where: { lotId: id } });
      await tx.expense.deleteMany({ where: { lotId: id } });
      await tx.hajiTransfer.deleteMany({ where: { lotId: id } });
      await tx.lot.delete({ where: { id } });
      await createAuditLog(user.userId, null, "lots", id, "delete", { lotNumber: lot.lotNumber }, undefined, getClientIP(request), tx);
    });
    return successResponse({ id }, "Lot deleted");
  } catch (error: any) {
    console.error("Delete lot error:", error?.message);
    return serverError();
  }
});
