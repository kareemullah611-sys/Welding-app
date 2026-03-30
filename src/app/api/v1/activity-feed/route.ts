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

    // Collect IDs by entity type
    const entityIds: Record<string, number[]> = {};
    for (const log of logs) {
      if (!entityIds[log.entityType]) entityIds[log.entityType] = [];
      entityIds[log.entityType].push(log.entityId);
    }

    // Batch fetch each entity type
    const [sales, payments, expenses, customers, lots, godownTransfers, hajiTransfers, personalWithdrawals, products, users, cityTransfers, supplierPayments, lotCosts] = await Promise.all([
      entityIds["sale"]?.length ? prisma.sale.findMany({ where: { id: { in: entityIds["sale"] } }, select: { id: true, voucherNo: true, totalAmount: true, customer: { select: { name: true } } } }) : Promise.resolve([]),
      entityIds["payment"]?.length ? prisma.payment.findMany({ where: { id: { in: entityIds["payment"] } }, select: { id: true, amount: true, detail: true, customer: { select: { name: true } } } }) : Promise.resolve([]),
      entityIds["expense"]?.length ? prisma.expense.findMany({ where: { id: { in: entityIds["expense"] } }, select: { id: true, amount: true, detail: true } }) : Promise.resolve([]),
      entityIds["customer"]?.length ? prisma.customer.findMany({ where: { id: { in: entityIds["customer"] } }, select: { id: true, name: true } }) : Promise.resolve([]),
      entityIds["lot"]?.length ? prisma.lot.findMany({ where: { id: { in: entityIds["lot"] } }, select: { id: true, lotNumber: true } }) : Promise.resolve([]),
      entityIds["godown_transfer"]?.length ? prisma.godownTransfer.findMany({ where: { id: { in: entityIds["godown_transfer"] } }, select: { id: true, qty: true, product: { select: { name: true } }, fromGodown: { select: { name: true } }, toGodown: { select: { name: true } } } }) : Promise.resolve([]),
      entityIds["haji_transfer"]?.length ? prisma.hajiTransfer.findMany({ where: { id: { in: entityIds["haji_transfer"] } }, select: { id: true, amount: true, detail: true } }) : Promise.resolve([]),
      entityIds["personal_withdrawal"]?.length ? prisma.personalWithdrawal.findMany({ where: { id: { in: entityIds["personal_withdrawal"] } }, select: { id: true, amount: true, detail: true } }) : Promise.resolve([]),
      entityIds["product"]?.length ? prisma.product.findMany({ where: { id: { in: entityIds["product"] } }, select: { id: true, name: true } }) : Promise.resolve([]),
      entityIds["user"]?.length ? prisma.user.findMany({ where: { id: { in: entityIds["user"] } }, select: { id: true, fullName: true } }) : Promise.resolve([]),
      entityIds["city_transfer"]?.length ? prisma.cityTransfer.findMany({ where: { id: { in: entityIds["city_transfer"] } }, select: { id: true, qty: true, product: { select: { name: true } }, fromCity: { select: { name: true } }, toCity: { select: { name: true } } } }) : Promise.resolve([]),
      entityIds["supplier_payment"]?.length ? prisma.supplierPayment.findMany({ where: { id: { in: entityIds["supplier_payment"] } }, select: { id: true, amountUsd: true, supplier: { select: { name: true } } } }) : Promise.resolve([]),
      entityIds["lot_cost"]?.length ? prisma.lotCost.findMany({ where: { id: { in: entityIds["lot_cost"] } }, select: { id: true, amount: true, costType: true, description: true } }) : Promise.resolve([]),
    ]);

    // Build lookup maps by ID
    const byId = <T extends { id: number }>(arr: T[]) => Object.fromEntries(arr.map(x => [x.id, x]));
    const saleMap = byId(sales as any[]);
    const paymentMap = byId(payments as any[]);
    const expenseMap = byId(expenses as any[]);
    const customerMap = byId(customers as any[]);
    const lotMap = byId(lots as any[]);
    const godownTransferMap = byId(godownTransfers as any[]);
    const hajiMap = byId(hajiTransfers as any[]);
    const pwMap = byId(personalWithdrawals as any[]);
    const productMap = byId(products as any[]);
    const userMap = byId(users as any[]);
    const cityTransferMap = byId(cityTransfers as any[]);
    const spMap = byId(supplierPayments as any[]);
    const lcMap = byId(lotCosts as any[]);

    const enriched = logs.map((log) => {
      let entityLabel = "";
      let entityDetail = "";
      try {
        const eid = log.entityId;
        switch (log.entityType) {
          case "sale": { const e = saleMap[eid]; if (e) { entityLabel = `Sale #${e.voucherNo}`; entityDetail = `${e.customer.name} — ${Number(e.totalAmount).toLocaleString("en-US")}`; } break; }
          case "payment": { const e = paymentMap[eid]; if (e) { entityLabel = `Payment`; entityDetail = `${e.customer.name} — ${Number(e.amount).toLocaleString("en-US")} — ${e.detail}`; } break; }
          case "expense": { const e = expenseMap[eid]; if (e) { entityLabel = `Expense`; entityDetail = `${Number(e.amount).toLocaleString("en-US")} — ${e.detail}`; } break; }
          case "customer": { const e = customerMap[eid]; if (e) { entityLabel = `Customer`; entityDetail = e.name; } break; }
          case "lot": { const e = lotMap[eid]; if (e) { entityLabel = `Lot ${e.lotNumber}`; entityDetail = ""; } break; }
          case "godown_transfer": { const e = godownTransferMap[eid]; if (e) { entityLabel = `Godown Transfer`; entityDetail = `${Number(e.qty)} ${e.product.name} — ${e.fromGodown.name} → ${e.toGodown.name}`; } break; }
          case "haji_transfer": { const e = hajiMap[eid]; if (e) { entityLabel = `Haji Transfer`; entityDetail = `${Number(e.amount).toLocaleString("en-US")} — ${e.detail}`; } break; }
          case "personal_withdrawal": { const e = pwMap[eid]; if (e) { entityLabel = `Personal Withdrawal`; entityDetail = `${Number(e.amount).toLocaleString("en-US")} — ${e.detail}`; } break; }
          case "product": { const e = productMap[eid]; if (e) { entityLabel = `Product`; entityDetail = e.name; } break; }
          case "user": { const e = userMap[eid]; if (e) { entityLabel = `User`; entityDetail = e.fullName; } break; }
          case "city_transfer": { const e = cityTransferMap[eid]; if (e) { entityLabel = `City Transfer`; entityDetail = `${Number(e.qty)} ${e.product.name} — ${e.fromCity.name} → ${e.toCity.name}`; } break; }
          case "supplier_payment": { const e = spMap[eid]; if (e) { entityLabel = `Supplier Payment`; entityDetail = `${e.supplier.name} — $${Number(e.amountUsd).toLocaleString("en-US")}`; } break; }
          case "lot_cost": { const e = lcMap[eid]; if (e) { entityLabel = `Lot Cost (${e.costType.replace("_", " ")})`; entityDetail = `${Number(e.amount).toLocaleString("en-US")} — ${e.description}`; } break; }
          default: entityLabel = log.entityType.replace(/_/g, " "); entityDetail = `#${log.entityId}`;
        }
      } catch { entityLabel = log.entityType.replace(/_/g, " "); entityDetail = `#${log.entityId}`; }

      const ov = log.oldValues as Record<string, any> | null;
      const nv = log.newValues as Record<string, any> | null;
      if (!entityLabel && ov) {
        entityLabel = ov.customer || ov.voucher || ov.name || log.entityType.replace(/_/g, " ");
        entityDetail = [ov.amount || ov.total, ov.detail, ov.destination].filter(Boolean).join(" · ");
      }

      return {
        id: log.id, user: log.user, city: log.city, action: log.action,
        entityType: log.entityType, entityId: log.entityId,
        entityLabel: entityLabel || log.entityType.replace(/_/g, " "),
        entityDetail, oldValues: ov, newValues: nv,
        createdAt: log.createdAt.toISOString(),
      };
    });

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
