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
    const cityId = godownId
      ? undefined
      : (user.role === "city_admin" ? user.cityId! : (searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined));

    const stock: any[] = await prisma.$queryRaw`
      WITH received AS (
        SELECT source.godown_id, source.product_id, SUM(source.qty) as qty
        FROM (
          SELECT lcga.godown_id, lcd.product_id, lcga.qty
          FROM lot_city_godown_allocations lcga
          JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
          JOIN godowns g ON g.id = lcga.godown_id
          WHERE (${godownId}::int IS NULL OR lcga.godown_id = ${godownId})
            AND (${cityId}::int IS NULL OR g.city_id = ${cityId})
          UNION ALL
          SELECT os.godown_id, os.product_id, os.qty
          FROM opening_stocks os
          WHERE (${godownId}::int IS NULL OR os.godown_id = ${godownId})
            AND (${cityId}::int IS NULL OR os.city_id = ${cityId})
          UNION ALL
          SELECT ct.to_godown_id, ct.product_id, ct.qty
          FROM city_transfers ct
          JOIN godowns g ON g.id = ct.to_godown_id
          WHERE ct.status = 'approved' AND ct.opening_inventory_valuation_id IS NOT NULL
            AND (${godownId}::int IS NULL OR ct.to_godown_id = ${godownId})
            AND (${cityId}::int IS NULL OR g.city_id = ${cityId})
        ) source
        GROUP BY source.godown_id, source.product_id
      ),
      sold AS (
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
      legacy_city_transferred_out AS (
        SELECT ct.from_godown_id as godown_id, ct.product_id, COALESCE(SUM(ct.qty), 0) as qty
        FROM city_transfers ct
        WHERE (${godownId}::int IS NULL OR ct.from_godown_id = ${godownId})
          AND ((ct.status = 'pending' AND ct.batch_id IS NULL)
            OR (ct.status IN ('pending', 'approved') AND ct.opening_inventory_valuation_id IS NOT NULL))
        GROUP BY ct.from_godown_id, ct.product_id
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
        p.unit_of_measure, p.pieces_per_carton,
        COALESCE(r.qty, 0) as received,
        COALESCE(s.qty, 0) as sold,
        COALESCE(tout.qty, 0) as transferred_out,
        COALESCE(tin.qty, 0) as transferred_in,
        (COALESCE(r.qty, 0) - COALESCE(s.qty, 0) - COALESCE(tout.qty, 0) - COALESCE(lctout.qty, 0) + COALESCE(tin.qty, 0)) as available
      FROM godowns g
      CROSS JOIN products p
      LEFT JOIN received r ON r.godown_id = g.id AND r.product_id = p.id
      LEFT JOIN sold s ON s.godown_id = g.id AND s.product_id = p.id
      LEFT JOIN transferred_out tout ON tout.godown_id = g.id AND tout.product_id = p.id
      LEFT JOIN legacy_city_transferred_out lctout ON lctout.godown_id = g.id AND lctout.product_id = p.id
      LEFT JOIN transferred_in tin ON tin.godown_id = g.id AND tin.product_id = p.id
      WHERE g.is_active = true AND p.is_active = true
        AND (${godownId}::int IS NULL OR g.id = ${godownId})
        AND (${cityId}::int IS NULL OR g.city_id = ${cityId})
        AND (COALESCE(r.qty, 0) > 0 OR COALESCE(s.qty, 0) > 0 OR COALESCE(tout.qty, 0) > 0 OR COALESCE(lctout.qty, 0) > 0 OR COALESCE(tin.qty, 0) > 0)
      ORDER BY g.name, p.name
    `;

    const openingLayerStock: any[] = await prisma.$queryRaw`
      SELECT candidates.godown_id, candidates.product_id, oiv.id as opening_inventory_valuation_id,
        oiv.opening_date,
        (COALESCE((SELECT SUM(os.qty) FROM opening_stocks os
            WHERE os.godown_id = candidates.godown_id AND os.product_id = candidates.product_id AND os.city_id = oiv.city_id), 0)
          + COALESCE((SELECT SUM(ct_in.qty) FROM city_transfers ct_in
              WHERE ct_in.to_godown_id = candidates.godown_id AND ct_in.product_id = candidates.product_id
                AND ct_in.opening_inventory_valuation_id = oiv.id AND ct_in.status = 'approved'), 0)
          - COALESCE((SELECT SUM(si.qty) FROM sale_items si JOIN sales s ON s.id = si.sale_id
              WHERE s.godown_id = candidates.godown_id AND s.status IN ('active', 'marked_short')
                AND si.product_id = candidates.product_id AND si.opening_inventory_valuation_id = oiv.id), 0)
          - COALESCE((SELECT SUM(gt.qty) FROM godown_transfers gt
              WHERE gt.from_godown_id = candidates.godown_id AND gt.product_id = candidates.product_id
                AND gt.opening_inventory_valuation_id = oiv.id), 0)
          - COALESCE((SELECT SUM(ct.qty) FROM city_transfers ct
              WHERE ct.from_godown_id = candidates.godown_id AND ct.product_id = candidates.product_id
                AND ct.opening_inventory_valuation_id = oiv.id AND ct.status IN ('pending', 'approved')), 0)
          + COALESCE((SELECT SUM(gt.qty) FROM godown_transfers gt
              WHERE gt.to_godown_id = candidates.godown_id AND gt.product_id = candidates.product_id
                AND gt.opening_inventory_valuation_id = oiv.id), 0)
        ) as available
      FROM (
        SELECT os.godown_id, os.product_id, oiv.id AS opening_inventory_valuation_id
        FROM opening_stocks os
        JOIN opening_inventory_valuations oiv ON oiv.city_id = os.city_id AND oiv.product_id = os.product_id
        UNION
        SELECT ct_in.to_godown_id, ct_in.product_id, ct_in.opening_inventory_valuation_id
        FROM city_transfers ct_in
        WHERE ct_in.status = 'approved' AND ct_in.opening_inventory_valuation_id IS NOT NULL
        UNION
        SELECT gt_in.to_godown_id, gt_in.product_id, gt_in.opening_inventory_valuation_id
        FROM godown_transfers gt_in
        WHERE gt_in.opening_inventory_valuation_id IS NOT NULL
      ) candidates
      JOIN godowns candidate_godown ON candidate_godown.id = candidates.godown_id
      JOIN opening_inventory_valuations oiv ON oiv.id = candidates.opening_inventory_valuation_id
      WHERE (${godownId}::int IS NULL OR candidates.godown_id = ${godownId})
        AND (${cityId}::int IS NULL OR candidate_godown.city_id = ${cityId})
    `;

    const lotStock: any[] = await prisma.$queryRaw`
      WITH received AS (
        SELECT lcga.godown_id, lcd.lot_id, lcd.product_id, COALESCE(SUM(lcga.qty), 0) as qty
        FROM lot_city_godown_allocations lcga
        JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
        JOIN godowns g ON g.id = lcga.godown_id
        WHERE (${godownId}::int IS NULL OR lcga.godown_id = ${godownId})
          AND (${cityId}::int IS NULL OR g.city_id = ${cityId})
        GROUP BY lcga.godown_id, lcd.lot_id, lcd.product_id
      ),
      sold AS (
        SELECT s.godown_id, si.lot_id, si.product_id, COALESCE(SUM(si.qty), 0) as qty
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id AND s.status IN ('active', 'marked_short')
        WHERE (${godownId}::int IS NULL OR s.godown_id = ${godownId})
          AND (${cityId}::int IS NULL OR s.city_id = ${cityId})
        GROUP BY s.godown_id, si.lot_id, si.product_id
      ),
      transferred_out AS (
        SELECT gt.from_godown_id as godown_id, gt.lot_id, gt.product_id, COALESCE(SUM(gt.qty), 0) as qty
        FROM godown_transfers gt
        WHERE (${godownId}::int IS NULL OR gt.from_godown_id = ${godownId})
        GROUP BY gt.from_godown_id, gt.lot_id, gt.product_id
      ),
      legacy_city_transferred_out AS (
        SELECT ct.from_godown_id as godown_id, ct.lot_id, ct.product_id, COALESCE(SUM(ct.qty), 0) as qty
        FROM city_transfers ct
        WHERE (${godownId}::int IS NULL OR ct.from_godown_id = ${godownId})
          AND ct.status = 'pending'
          AND ct.batch_id IS NULL
        GROUP BY ct.from_godown_id, ct.lot_id, ct.product_id
      ),
      transferred_in AS (
        SELECT gt.to_godown_id as godown_id, gt.lot_id, gt.product_id, COALESCE(SUM(gt.qty), 0) as qty
        FROM godown_transfers gt
        WHERE (${godownId}::int IS NULL OR gt.to_godown_id = ${godownId})
        GROUP BY gt.to_godown_id, gt.lot_id, gt.product_id
      )
      SELECT
        g.id as godown_id, p.id as product_id,
        l.id as lot_id, l.lot_number, l.lot_date,
        p.unit_of_measure, p.pieces_per_carton,
        (COALESCE(r.qty, 0) - COALESCE(s.qty, 0) - COALESCE(tout.qty, 0) - COALESCE(lctout.qty, 0) + COALESCE(tin.qty, 0)) as available
      FROM godowns g
      CROSS JOIN products p
      JOIN lots l ON l.status = 'ongoing'
      LEFT JOIN received r ON r.godown_id = g.id AND r.product_id = p.id AND r.lot_id = l.id
      LEFT JOIN sold s ON s.godown_id = g.id AND s.product_id = p.id AND s.lot_id = l.id
      LEFT JOIN transferred_out tout ON tout.godown_id = g.id AND tout.product_id = p.id AND tout.lot_id = l.id
      LEFT JOIN legacy_city_transferred_out lctout ON lctout.godown_id = g.id AND lctout.product_id = p.id AND lctout.lot_id = l.id
      LEFT JOIN transferred_in tin ON tin.godown_id = g.id AND tin.product_id = p.id AND tin.lot_id = l.id
      WHERE g.is_active = true AND p.is_active = true
        AND (${godownId}::int IS NULL OR g.id = ${godownId})
        AND (${cityId}::int IS NULL OR g.city_id = ${cityId})
        AND (COALESCE(r.qty, 0) > 0 OR COALESCE(s.qty, 0) > 0 OR COALESCE(tout.qty, 0) > 0 OR COALESCE(lctout.qty, 0) > 0 OR COALESCE(tin.qty, 0) > 0)
      ORDER BY l.lot_date ASC, l.id ASC
    `;

    const displayQty = (value: unknown, row: any) => {
      const qty = Number(value || 0);
      return row.unit_of_measure === "PCS" && Number(row.pieces_per_carton || 0) > 0
        ? qty / Number(row.pieces_per_carton)
        : qty;
    };

    const lotBreakdownByProduct = new Map<string, any[]>();
    for (const row of openingLayerStock) {
      const available = Math.round(Number(row.available || 0) * 100) / 100;
      if (available <= 0) continue;
      const key = `${row.godown_id}:${row.product_id}`;
      const rows = lotBreakdownByProduct.get(key) || [];
      rows.push({
        sourceType: "opening",
        lotId: null,
        openingInventoryValuationId: row.opening_inventory_valuation_id,
        lotNumber: "Opening Stock",
        available,
      });
      lotBreakdownByProduct.set(key, rows);
    }
    for (const row of lotStock) {
      const available = Math.round(displayQty(row.available, row) * 100) / 100;
      if (available <= 0) continue;
      const key = `${row.godown_id}:${row.product_id}`;
      const rows = lotBreakdownByProduct.get(key) || [];
      rows.push({
        sourceType: "lot",
        lotId: row.lot_id,
        lotNumber: row.lot_number,
        available,
      });
      lotBreakdownByProduct.set(key, rows);
    }

    return successResponse(stock.map((row) => ({
      godownId: row.godown_id,
      godownName: row.godown_name,
      productId: row.product_id,
      productName: row.product_name,
      unitOfMeasure: row.unit_of_measure,
      piecesPerCarton: row.pieces_per_carton,
      openingQty: Math.round(Number(openingLayerStock.find((item) => item.godown_id === row.godown_id && item.product_id === row.product_id)?.available || 0) * 100) / 100,
      received: Math.round(displayQty(row.received, row) * 100) / 100,
      sold: Math.round(displayQty(row.sold, row) * 100) / 100,
      transferredOut: Math.round(displayQty(row.transferred_out, row) * 100) / 100,
      transferredIn: Math.round(displayQty(row.transferred_in, row) * 100) / 100,
      available: Math.round(displayQty(row.available, row) * 100) / 100,
      lotBreakdown: lotBreakdownByProduct.get(`${row.godown_id}:${row.product_id}`) || [],
    })));
  } catch (error) {
    console.error("Godown stock error:", error);
    return serverError();
  }
});
