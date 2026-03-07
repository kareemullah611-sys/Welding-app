import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope } from "@/lib/middleware";
import { successResponse, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(searchParams);
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);

    const where: any = {};
    if (cityId) where.cityId = cityId;

    const logs = await prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true, username: true } },
        city: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    });

    // Enrich logs with entity details
    const enriched = await Promise.all(
      logs.map(async (log) => {
        let entityLabel = "";
        let entityDetail = "";

        try {
          switch (log.entityType) {
            case "sale": {
              const sale = await prisma.sale.findUnique({
                where: { id: log.entityId },
                select: { voucherNo: true, totalAmount: true, customer: { select: { name: true } } },
              });
              if (sale) {
                entityLabel = `Sale #${sale.voucherNo}`;
                entityDetail = `${sale.customer.name} — ${Number(sale.totalAmount).toLocaleString()}`;
              }
              break;
            }
            case "payment": {
              const payment = await prisma.payment.findUnique({
                where: { id: log.entityId },
                select: { amount: true, detail: true, customer: { select: { name: true } } },
              });
              if (payment) {
                entityLabel = `Payment`;
                entityDetail = `${payment.customer.name} — ${Number(payment.amount).toLocaleString()} — ${payment.detail}`;
              }
              break;
            }
            case "expense": {
              const expense = await prisma.expense.findUnique({
                where: { id: log.entityId },
                select: { amount: true, detail: true },
              });
              if (expense) {
                entityLabel = `Expense`;
                entityDetail = `${Number(expense.amount).toLocaleString()} — ${expense.detail}`;
              }
              break;
            }
            case "customer": {
              const customer = await prisma.customer.findUnique({
                where: { id: log.entityId },
                select: { name: true },
              });
              if (customer) {
                entityLabel = `Customer`;
                entityDetail = customer.name;
              }
              break;
            }
            case "lot": {
              const lot = await prisma.lot.findUnique({
                where: { id: log.entityId },
                select: { lotNumber: true },
              });
              if (lot) {
                entityLabel = `Lot ${lot.lotNumber}`;
                entityDetail = "";
              }
              break;
            }
            case "godown_transfer": {
              const transfer = await prisma.godownTransfer.findUnique({
                where: { id: log.entityId },
                select: {
                  qty: true,
                  product: { select: { name: true } },
                  fromGodown: { select: { name: true } },
                  toGodown: { select: { name: true } },
                },
              });
              if (transfer) {
                entityLabel = `Godown Transfer`;
                entityDetail = `${Number(transfer.qty)} ${transfer.product.name} — ${transfer.fromGodown.name} → ${transfer.toGodown.name}`;
              }
              break;
            }
            case "haji_transfer": {
              const ht = await prisma.hajiTransfer.findUnique({
                where: { id: log.entityId },
                select: { amount: true, detail: true },
              });
              if (ht) {
                entityLabel = `Haji Transfer`;
                entityDetail = `${Number(ht.amount).toLocaleString()} — ${ht.detail}`;
              }
              break;
            }
            case "personal_withdrawal": {
              const pw = await prisma.personalWithdrawal.findUnique({
                where: { id: log.entityId },
                select: { amount: true, detail: true },
              });
              if (pw) {
                entityLabel = `Personal Withdrawal`;
                entityDetail = `${Number(pw.amount).toLocaleString()} — ${pw.detail}`;
              }
              break;
            }
            case "product": {
              const product = await prisma.product.findUnique({
                where: { id: log.entityId },
                select: { name: true },
              });
              if (product) {
                entityLabel = `Product`;
                entityDetail = product.name;
              }
              break;
            }
            case "user": {
              const targetUser = await prisma.user.findUnique({
                where: { id: log.entityId },
                select: { fullName: true },
              });
              if (targetUser) {
                entityLabel = `User`;
                entityDetail = targetUser.fullName;
              }
              break;
            }
            case "city_transfer": {
              const ct = await prisma.cityTransfer.findUnique({
                where: { id: log.entityId },
                select: {
                  qty: true,
                  product: { select: { name: true } },
                  fromCity: { select: { name: true } },
                  toCity: { select: { name: true } },
                },
              });
              if (ct) {
                entityLabel = `City Transfer`;
                entityDetail = `${Number(ct.qty)} ${ct.product.name} — ${ct.fromCity.name} → ${ct.toCity.name}`;
              }
              break;
            }
            case "supplier_payment": {
              const sp = await prisma.supplierPayment.findUnique({
                where: { id: log.entityId },
                select: { amountUsd: true, supplier: { select: { name: true } } },
              });
              if (sp) {
                entityLabel = `Supplier Payment`;
                entityDetail = `${sp.supplier.name} — $${Number(sp.amountUsd).toLocaleString()}`;
              }
              break;
            }
            case "lot_cost": {
              const lc = await prisma.lotCost.findUnique({
                where: { id: log.entityId },
                select: { amount: true, costType: true, description: true },
              });
              if (lc) {
                entityLabel = `Lot Cost (${lc.costType.replace("_", " ")})`;
                entityDetail = `${Number(lc.amount).toLocaleString()} — ${lc.description}`;
              }
              break;
            }
            default:
              entityLabel = log.entityType.replace(/_/g, " ");
              entityDetail = `#${log.entityId}`;
          }
        } catch {
          entityLabel = log.entityType.replace(/_/g, " ");
          entityDetail = `#${log.entityId}`;
        }

        return {
          id: log.id,
          user: log.user,
          city: log.city,
          action: log.action,
          entityType: log.entityType,
          entityId: log.entityId,
          entityLabel: entityLabel || log.entityType.replace(/_/g, " "),
          entityDetail,
          createdAt: log.createdAt.toISOString(),
        };
      })
    );

    const total = await prisma.auditLog.count({ where });

    return successResponse({
      items: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Activity feed error:", error);
    return serverError();
  }
});
