import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/inventory/godown-stock?godown_id=1
// Returns available stock for each product in a specific godown
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const godownId = searchParams.get("godown_id") ? parseInt(searchParams.get("godown_id")!) : undefined;
    // When a specific godown_id is requested (e.g. cross-city godown), do NOT restrict by cityId —
    // the godown itself already scopes the query. cityId restriction is only applied when browsing all godowns.
    const cityId = godownId
      ? undefined
      : (user.role === "city_admin" ? user.cityId! : (searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined));

    const stock: any[] = await prisma.$queryRaw`
      WITH received AS (
        SELECT lcga.godown_id, lcd.product_id, COALESCE(SUM(lcga.qty), 0) as qty
        FROM lot_city_godown_allocations lcga
        JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
        JOIN godowns g ON g.id = lcga.godown_id
        WHERE (${godownId}::int IS NULL OR lcga.godown_id = ${godownId})
          AND (${cityId}::int IS NULL OR g.city_id = ${cityId})
        GROUP BY lcga.godown_id, lcd.product_id
      ),
      opening_stock AS (
        SELECT os.godown_id, os.product_id, COALESCE(SUM(os.qty), 0) as qty
        FROM opening_stocks os
        JOIN godowns g ON g.id = os.godown_id
        WHERE (${godownId}::int IS NULL OR os.godown_id = ${godownId})
          AND (${cityId}::int IS NULL OR g.city_id = ${cityId})
        GROUP BY os.godown_id, os.product_id
      ),
      sold AS (
        -- Count both active and marked_short sales; when godown_id given don't restrict by city
        -- (cross-city sales have city_id = selling city but godown_id = source godown)
        SELECT s.godown_id, si.product_id, COALESCE(SUM(si.qty), 0) as qty
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id AND s.status IN ('active', 'marked_short')
        WHERE (${godownId}::int IS NULL OR s.godown_id = ${godownId})
          AND (${cityId}::int IS NULL OR s.city_id = ${cityId})
        GROUP BY s.godown_id, si.product_id
      ),
      transferred_out AS (
        SELECT gt.from_godown_id as godown_id, gt.product_id, COALESCE(SUM(gt.qty), 0) as qty
        FROM godown_transfers gt
        WHERE (${godownId}::int IS NULL OR gt.from_godown_id = ${godownId})
        GROUP BY gt.from_godown_id, gt.product_id
      ),
      transferred_in AS (
        SELECT gt.to_godown_id as godown_id, gt.product_id, COALESCE(SUM(gt.qty), 0) as qty
        FROM godown_transfers gt
        WHERE (${godownId}::int IS NULL OR gt.to_godown_id = ${godownId})
        GROUP BY gt.to_godown_id, gt.product_id
      )
      SELECT
        g.id as godown_id, g.name as godown_name,
        p.id as product_id, p.name as product_name,
        COALESCE(os.qty, 0) as opening_qty,
        COALESCE(r.qty, 0) as received,
        COALESCE(s.qty, 0) as sold,
        COALESCE(tout.qty, 0) as transferred_out,
        COALESCE(tin.qty, 0) as transferred_in,
        (COALESCE(os.qty, 0) + COALESCE(r.qty, 0) - COALESCE(s.qty, 0) - COALESCE(tout.qty, 0) + COALESCE(tin.qty, 0)) as available
      FROM godowns g
      CROSS JOIN products p
      LEFT JOIN opening_stock os ON os.godown_id = g.id AND os.product_id = p.id
      LEFT JOIN received r ON r.godown_id = g.id AND r.product_id = p.id
      LEFT JOIN sold s ON s.godown_id = g.id AND s.product_id = p.id
      LEFT JOIN transferred_out tout ON tout.godown_id = g.id AND tout.product_id = p.id
      LEFT JOIN transferred_in tin ON tin.godown_id = g.id AND tin.product_id = p.id
      WHERE g.is_active = true AND p.is_active = true
        AND (${godownId}::int IS NULL OR g.id = ${godownId})
        AND (${cityId}::int IS NULL OR g.city_id = ${cityId})
        AND (COALESCE(os.qty, 0) > 0 OR COALESCE(r.qty, 0) > 0 OR COALESCE(s.qty, 0) > 0 OR COALESCE(tout.qty, 0) > 0 OR COALESCE(tin.qty, 0) > 0)
      ORDER BY g.name, p.name
    `;

    return successResponse(stock.map((row) => ({
      godownId: row.godown_id,
      godownName: row.godown_name,
      productId: row.product_id,
      productName: row.product_name,
      openingQty: Math.round(Number(row.opening_qty) * 100) / 100,
      received: Math.round(Number(row.received) * 100) / 100,
      sold: Math.round(Number(row.sold) * 100) / 100,
      transferredOut: Math.round(Number(row.transferred_out) * 100) / 100,
      transferredIn: Math.round(Number(row.transferred_in) * 100) / 100,
      available: Math.round(Number(row.available) * 100) / 100,
    })));
  } catch (error) {
    console.error("Godown stock error:", error);
    return serverError();
  }
});
