import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { SaleStatus } from "@prisma/client";
import { computeOngoingLotHajiOwedByCity, computeOngoingLotHajiOwedForCity } from "@/lib/ongoing-lot-haji-owed";
import { REVENUE_SALE_STATUSES } from "@/lib/sale-status";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const cityId = user.role === "city_admin" ? user.cityId! : undefined;
    const cityFilter = cityId ? { cityId } : {};
    // Fix C5: use the shared constant so dashboard and lot-completion agree.
    const includedSaleStatuses: SaleStatus[] = REVENUE_SALE_STATUSES;

    // Build a currency-id → code lookup once (tiny table, very fast)
    const currencies = await prisma.currency.findMany({ select: { id: true, code: true } });
    const currCode: Record<number, string> = Object.fromEntries(currencies.map((c) => [c.id, c.code]));

    // ── Core aggregates (all DB-side, no row scanning in JS) ──────────────────
    const [salesByC, paymentsByC, hajiByC, wdByC, expByC, openingCashByC, openingCustomerByC, cartonsSold] = await Promise.all([
      prisma.sale.groupBy({
        by: ["currencyId"],
        where: { ...cityFilter, status: { in: includedSaleStatuses }, isOpeningImport: false },
        _sum: { totalAmount: true },
      }),
      prisma.payment.groupBy({
        by: ["currencyId", "destination"],
        where: { ...cityFilter, status: "active" },
        _sum: { amount: true },
      }),
      prisma.hajiTransfer.groupBy({
        by: ["currencyId", "transferType"],
        where: cityFilter,
        _sum: { amount: true },
      }),
      prisma.personalWithdrawal.groupBy({
        by: ["currencyId"],
        // Fix C7: only count APPROVED withdrawals.
        where: { ...cityFilter, approvedAt: { not: null } } as any,
        _sum: { amount: true },
      }),
      prisma.expense.groupBy({
        by: ["currencyId"],
        where: { ...cityFilter, deletedAt: null },
        _sum: { amount: true },
      }),
      prisma.openingCash.groupBy({
        by: ["currencyId"],
        where: cityFilter,
        _sum: { amount: true },
      }),
      prisma.openingCustomerBalance.groupBy({
        by: ["currencyId"],
        where: cityId ? { customer: { cityId } } : {},
        _sum: { amount: true },
      }),
      prisma.saleItem.aggregate({
        where: { sale: { ...cityFilter, status: { in: includedSaleStatuses } } },
        _sum: { qty: true },
      }),
    ]);
    
    // Build currency-keyed maps
    const salesByCurrency: Record<string, number> = {};
    for (const s of salesByC) {
      salesByCurrency[currCode[s.currencyId]] = Number(s._sum.totalAmount || 0);
    }

    const paymentsByCurrency: Record<string, number> = {};
    for (const p of paymentsByC) {
      const code = currCode[p.currencyId];
      paymentsByCurrency[code] = (paymentsByCurrency[code] || 0) + Number(p._sum.amount || 0);
    }

    const outstandingByCurrency: Record<string, number> = {};
    for (const cc of Array.from(new Set([...Object.keys(salesByCurrency), ...Object.keys(paymentsByCurrency)]))) {
      outstandingByCurrency[cc] = Math.round(((salesByCurrency[cc] || 0) - (paymentsByCurrency[cc] || 0)) * 100) / 100;
    }
    for (const o of openingCustomerByC) {
      const code = currCode[o.currencyId];
      outstandingByCurrency[code] = Math.round(((outstandingByCurrency[code] || 0) + Number(o._sum.amount || 0)) * 100) / 100;
    }

    // Total haji transfers (used for cash position)
    const hajiTransferByCurrency: Record<string, number> = {};
    for (const h of hajiByC) {
      const code = currCode[h.currencyId];
      hajiTransferByCurrency[code] = (hajiTransferByCurrency[code] || 0) + Number(h._sum.amount || 0);
    }

    const withdrawalByCurrency: Record<string, number> = {};
    for (const w of wdByC) {
      withdrawalByCurrency[currCode[w.currencyId]] = Number(w._sum.amount || 0);
    }

    const expenseByCurrency: Record<string, number> = {};
    for (const e of expByC) {
      expenseByCurrency[currCode[e.currencyId]] = Number(e._sum.amount || 0);
    }

    // Owed to Haji = opening payable/receivable plus net unsettled activity on ongoing lots.
    const hajiByCurrency = cityId
      ? await computeOngoingLotHajiOwedForCity(cityId)
      : {};

    const result: any = {
      outstandingByCurrency,
      hajiByCurrency: roundObj(hajiByCurrency),
      withdrawalByCurrency: roundObj(withdrawalByCurrency),
      expenseByCurrency: roundObj(expenseByCurrency),
      totalCartonsSold: Number(cartonsSold._sum.qty || 0),
      // Legacy fields for backward compat
      totalOutstanding: Object.entries(outstandingByCurrency).map(([currency, amount]) => ({ currency, amount })),
      totalOwedToHaji: Object.entries(hajiByCurrency).map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })),
      totalPersonalWithdrawals: Object.entries(withdrawalByCurrency).map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })),
    };

    // ── Supplier payable (super admin only) ───────────────────────────────────
    if (user.role === "super_admin") {
      const [openingSupplierPayable, openingSupplierReceivable, purchased, paid] = await Promise.all([
        prisma.openingLiability.aggregate({
          where: { supplierId: { not: null }, balanceSide: "payable", currency: { code: "USD" } },
          _sum: { amount: true },
        }),
        prisma.openingLiability.aggregate({
          where: { supplierId: { not: null }, balanceSide: "receivable", currency: { code: "USD" } },
          _sum: { amount: true },
        }),
        prisma.lotPurchase.aggregate({ _sum: { totalPriceUsd: true } }),
        prisma.supplierPayment.aggregate({ _sum: { amountUsd: true } }),
      ]);
      const totalOpening = Number(openingSupplierPayable._sum.amount || 0) - Number(openingSupplierReceivable._sum.amount || 0);
      const totalPurchased = Number(purchased._sum.totalPriceUsd || 0);
      const totalPaid = Number(paid._sum.amountUsd || 0);
      result.supplierPayable = {
        totalPurchasedUsd: totalPurchased,
        totalPaidUsd: totalPaid,
        openingUsd: totalOpening,
        balanceUsd: Math.round((totalOpening + totalPurchased - totalPaid) * 100) / 100,
      };
    }

    // ── Cash position (city admin) ────────────────────────────────────────────
    if (user.role === "city_admin") {
      const cashByCurrency: Record<string, number> = {};
      for (const o of openingCashByC) {
        const code = currCode[o.currencyId];
        cashByCurrency[code] = (cashByCurrency[code] || 0) + Number(o._sum.amount || 0);
      }

      // Payments to our_account → cash IN
      for (const p of paymentsByC.filter((p) => p.destination === "our_account")) {
        const code = currCode[p.currencyId];
        cashByCurrency[code] = (cashByCurrency[code] || 0) + Number(p._sum.amount || 0);
      }
      // Expenses → cash OUT
      for (const e of expByC) {
        const code = currCode[e.currencyId];
        cashByCurrency[code] = (cashByCurrency[code] || 0) - Number(e._sum.amount || 0);
      }
      // Withdrawals → cash OUT
      for (const w of wdByC) {
        const code = currCode[w.currencyId];
        cashByCurrency[code] = (cashByCurrency[code] || 0) - Number(w._sum.amount || 0);
      }
      // Haji transfers from in-hand → cash OUT
      for (const h of hajiByC.filter((h) => h.transferType === "from_in_hand")) {
        const code = currCode[h.currencyId];
        cashByCurrency[code] = (cashByCurrency[code] || 0) - Number(h._sum.amount || 0);
      }
      result.cashPositionByCurrency = roundObj(cashByCurrency);

      const ongoingLots = await prisma.lot.findMany({
        where: { countryId: user.countryId!, status: "ongoing", lotCityDistributions: { some: { cityId } } },
        select: { id: true, lotNumber: true, status: true, lotDate: true },
        orderBy: { lotDate: "asc" },
      });
      result.ongoingLots = ongoingLots.map((l) => ({
        id: l.id,
        lotNumber: l.lotNumber,
        status: l.status,
        lotDate: l.lotDate.toISOString().split("T")[0],
      }));
    }

    // ── Cities overview (super admin) ─────────────────────────────────────────
    // Single batch of 6 cross-city groupBy queries instead of N×6 per-city queries
    if (user.role === "super_admin") {
      const [cities, cSales, cPayments, cExpenses, cHaji, cWd, cOpeningCash, cOpeningCustomer, ongoingLotRows, hajiOwedByCity] = await Promise.all([
        prisma.city.findMany({ where: { isActive: true }, include: { country: true } }),
        prisma.sale.groupBy({
          by: ["cityId", "currencyId"],
          where: { status: { in: includedSaleStatuses }, isOpeningImport: false },
          _sum: { totalAmount: true },
        }),
        prisma.payment.groupBy({
          by: ["cityId", "currencyId", "destination"],
          where: { status: "active" },
          _sum: { amount: true },
        }),
        prisma.expense.groupBy({
          by: ["cityId", "currencyId"],
          where: { deletedAt: null },
          _sum: { amount: true },
        }),
        prisma.hajiTransfer.groupBy({
          by: ["cityId", "currencyId", "transferType"],
          _sum: { amount: true },
        }),
        prisma.personalWithdrawal.groupBy({
          by: ["cityId", "currencyId"],
          where: { approvedAt: { not: null } } as any,
          _sum: { amount: true },
        }),
        prisma.openingCash.groupBy({
          by: ["cityId", "currencyId"],
          _sum: { amount: true },
        }),
        prisma.openingCustomerBalance.groupBy({
          by: ["currencyId", "customerId"],
          _sum: { amount: true },
        }),
        prisma.lotCityDistribution.findMany({
          where: { lot: { status: "ongoing" } },
          select: { cityId: true, lotId: true },
          distinct: ["cityId", "lotId"],
        }),
        computeOngoingLotHajiOwedByCity(),
      ]);
      const activeLotsByCity: Record<number, number> = {};
      for (const row of ongoingLotRows) {
        activeLotsByCity[row.cityId] = (activeLotsByCity[row.cityId] || 0) + 1;
      }
      const customerCityById = Object.fromEntries(
        (
          await prisma.customer.findMany({
            where: { cityId: { in: cities.map((c) => c.id) } },
            select: { id: true, cityId: true },
          })
        ).map((c) => [c.id, c.cityId])
      );

      // Cartons per city via raw SQL (SaleItem has no direct cityId column)
      const cityCartonsRaw = await prisma.$queryRaw<{ city_id: number; total_qty: bigint }[]>`
        SELECT s.city_id, COALESCE(SUM(si.qty), 0) AS total_qty
        FROM sale_items si
        JOIN sales s ON si.sale_id = s.id
        WHERE s.status IN ('active', 'marked_short')
        GROUP BY s.city_id
      `;
      const cartonsMap: Record<number, number> = {};
      for (const r of cityCartonsRaw) { cartonsMap[r.city_id] = Number(r.total_qty); }

      // Aggregate per city in JS (O(cities × rows) but no extra DB round-trips)
      result.citiesOverview = cities.map((city) => {
        const cid = city.id;
        const outByCurr: Record<string, number> = {};
        const hajiByCurr: Record<string, number> = { ...(hajiOwedByCity.get(cid) || {}) };
        const wdByCurr: Record<string, number> = {};
        const cashByCurr: Record<string, number> = {};

        for (const s of cSales.filter((s) => s.cityId === cid)) {
          const code = currCode[s.currencyId];
          outByCurr[code] = (outByCurr[code] || 0) + Number(s._sum.totalAmount || 0);
        }
        for (const p of cPayments.filter((p) => p.cityId === cid)) {
          const code = currCode[p.currencyId];
          outByCurr[code] = (outByCurr[code] || 0) - Number(p._sum.amount || 0);
          if (p.destination === "our_account") {
            cashByCurr[code] = (cashByCurr[code] || 0) + Number(p._sum.amount || 0);
          }
        }
        for (const h of cHaji.filter((h) => h.cityId === cid)) {
          const code = currCode[h.currencyId];
          if (h.transferType === "from_in_hand") {
            cashByCurr[code] = (cashByCurr[code] || 0) - Number(h._sum.amount || 0);
          }
        }
        for (const w of cWd.filter((w) => w.cityId === cid)) {
          const code = currCode[w.currencyId];
          wdByCurr[code] = (wdByCurr[code] || 0) + Number(w._sum.amount || 0);
          cashByCurr[code] = (cashByCurr[code] || 0) - Number(w._sum.amount || 0);
        }
        for (const e of cExpenses.filter((e) => e.cityId === cid)) {
          const code = currCode[e.currencyId];
          cashByCurr[code] = (cashByCurr[code] || 0) - Number(e._sum.amount || 0);
        }
        for (const o of cOpeningCash.filter((o) => o.cityId === cid)) {
          const code = currCode[o.currencyId];
          cashByCurr[code] = (cashByCurr[code] || 0) + Number(o._sum.amount || 0);
        }
        for (const o of cOpeningCustomer) {
          if (customerCityById[o.customerId] !== cid) continue;
          const code = currCode[o.currencyId];
          outByCurr[code] = (outByCurr[code] || 0) + Number(o._sum.amount || 0);
        }

        return {
          cityId: cid,
          cityName: city.name,
          country: city.country.name,
          countryCode: city.country.code,
          outstandingByCurrency: roundObj(outByCurr),
          hajiByCurrency: roundObj(hajiByCurr),
          withdrawalByCurrency: roundObj(wdByCurr),
          cashByCurrency: roundObj(cashByCurr),
          cartonsSold: cartonsMap[cid] || 0,
          // Legacy fields
          outstanding: Object.values(outByCurr).reduce((s, v) => s + v, 0),
          owedToHaji: Object.values(hajiByCurr).reduce((s, v) => s + v, 0),
          personalWithdrawals: Object.values(wdByCurr).reduce((s, v) => s + v, 0),
          currency: city.country.code === "PK" ? "PKR" : "AFN",
          activeLots: activeLotsByCity[cid] || 0,
        };
      });
    }

    return successResponse(result);
  } catch (error) {
    console.error("Dashboard error:", error);
    return serverError();
  }
});

function roundObj(obj: Record<string, number>) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Math.round(v * 100) / 100]));
}
