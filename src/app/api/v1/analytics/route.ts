import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { Prisma } from "@prisma/client";

type Row = { period: string; total: string };

export const GET = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    const sp = request.nextUrl.searchParams;
    const period = sp.get("period") || "monthly";          // daily | monthly | yearly | custom
    const year   = parseInt(sp.get("year") || String(new Date().getFullYear()));
    const from   = sp.get("from");
    const to     = sp.get("to");
    const cityId = getCityScope(user, sp.get("cityId") ? parseInt(sp.get("cityId")!) : undefined);

    // ── Date range ─────────────────────────────────────────────────────────
    let dateFrom: Date;
    let dateTo:   Date;

    if (period === "custom" && from && to) {
      dateFrom = new Date(from);
      dateTo   = new Date(to);
    } else if (period === "daily") {
      dateTo   = new Date();
      dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - 29);
    } else if (period === "yearly") {
      dateFrom = new Date("2020-01-01");
      dateTo   = new Date();
    } else {
      // monthly
      dateFrom = new Date(`${year}-01-01`);
      dateTo   = new Date(`${year}-12-31`);
    }

    // ── City WHERE fragment ─────────────────────────────────────────────────
    const cityWhere     = cityId ? Prisma.sql`AND city_id = ${cityId}`       : Prisma.empty;
    const cityWhereAlias= cityId ? Prisma.sql`AND s.city_id = ${cityId}`     : Prisma.empty;

    // ── Group-by format ─────────────────────────────────────────────────────
    const fmtSql =
      period === "daily" || period === "custom"
        ? Prisma.sql`'YYYY-MM-DD'`
        : period === "monthly"
        ? Prisma.sql`'YYYY-MM'`
        : Prisma.sql`'YYYY'`;

    // ── Queries ─────────────────────────────────────────────────────────────
    const [salesRows, cartonsRows, paymentsRows, expensesRows, hajiRows] = await Promise.all([

      // Revenue (total_amount on sales, already computed)
      prisma.$queryRaw<Row[]>`
        SELECT TO_CHAR(sale_date, ${fmtSql}) AS period,
               COALESCE(SUM(total_amount), 0)::text AS total
        FROM   sales
        WHERE  status = 'active'
          AND  sale_date >= ${dateFrom}
          AND  sale_date <= ${dateTo}
          ${cityWhere}
        GROUP  BY period
        ORDER  BY period`,

      // Cartons sold
      prisma.$queryRaw<Row[]>`
        SELECT TO_CHAR(s.sale_date, ${fmtSql}) AS period,
               COALESCE(SUM(si.qty), 0)::text AS total
        FROM   sales s
        JOIN   sale_items si ON si.sale_id = s.id
        WHERE  s.status = 'active'
          AND  s.sale_date >= ${dateFrom}
          AND  s.sale_date <= ${dateTo}
          ${cityWhereAlias}
        GROUP  BY period
        ORDER  BY period`,

      // Payments received
      prisma.$queryRaw<Row[]>`
        SELECT TO_CHAR(payment_date, ${fmtSql}) AS period,
               COALESCE(SUM(amount), 0)::text AS total
        FROM   payments
        WHERE  status = 'active'
          AND  payment_date >= ${dateFrom}
          AND  payment_date <= ${dateTo}
          ${cityWhere}
        GROUP  BY period
        ORDER  BY period`,

      // Expenses
      prisma.$queryRaw<Row[]>`
        SELECT TO_CHAR(expense_date, ${fmtSql}) AS period,
               COALESCE(SUM(amount), 0)::text AS total
        FROM   expenses
        WHERE  deleted_at IS NULL
          AND  expense_date >= ${dateFrom}
          AND  expense_date <= ${dateTo}
          ${cityWhere}
        GROUP  BY period
        ORDER  BY period`,

      // Haji transfers
      prisma.$queryRaw<Row[]>`
        SELECT TO_CHAR(transfer_date, ${fmtSql}) AS period,
               COALESCE(SUM(amount), 0)::text AS total
        FROM   haji_transfers
        WHERE  transfer_date >= ${dateFrom}
          AND  transfer_date <= ${dateTo}
          ${cityWhere}
        GROUP  BY period
        ORDER  BY period`,
    ]);

    // ── Merge all periods ───────────────────────────────────────────────────
    const allPeriods = Array.from(
      new Set([
        ...salesRows.map((r) => r.period),
        ...paymentsRows.map((r) => r.period),
        ...expensesRows.map((r) => r.period),
        ...hajiRows.map((r) => r.period),
      ])
    ).sort();

    const toMap = (rows: Row[]) =>
      Object.fromEntries(rows.map((r) => [r.period, parseFloat(r.total) || 0]));

    const salesMap    = toMap(salesRows);
    const cartonsMap  = toMap(cartonsRows);
    const paymentsMap = toMap(paymentsRows);
    const expensesMap = toMap(expensesRows);
    const hajiMap     = toMap(hajiRows);

    // ── Format display labels ───────────────────────────────────────────────
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const formatLabel = (p: string) => {
      if (p.length === 4)  return p;           // YYYY
      if (p.length === 7) {                    // YYYY-MM
        const [y, m] = p.split("-");
        return `${months[parseInt(m) - 1]} ${y}`;
      }
      // YYYY-MM-DD → dd/mm
      const [, m, d] = p.split("-");
      return `${d}/${m}`;
    };

    const chartData = allPeriods.map((p) => ({
      label:         formatLabel(p),
      period:        p,
      sales:         salesMap[p]    || 0,
      cartons:       cartonsMap[p]  || 0,
      payments:      paymentsMap[p] || 0,
      expenses:      expensesMap[p] || 0,
      hajiTransfers: hajiMap[p]    || 0,
    }));

    // ── Totals ──────────────────────────────────────────────────────────────
    const totals = {
      sales:         chartData.reduce((s, r) => s + r.sales,         0),
      cartons:       chartData.reduce((s, r) => s + r.cartons,       0),
      payments:      chartData.reduce((s, r) => s + r.payments,      0),
      expenses:      chartData.reduce((s, r) => s + r.expenses,      0),
      hajiTransfers: chartData.reduce((s, r) => s + r.hajiTransfers, 0),
    };

    return successResponse({ chartData, totals, period, year });
  } catch (e) {
    console.error("[analytics]", e);
    return serverError("Failed to load analytics");
  }
});
