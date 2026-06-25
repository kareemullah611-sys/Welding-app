import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/inventory/stock-ledger?godown_id=1&product_id=2&date_from=2024-01-01&date_to=2024-12-31
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const sp = request.nextUrl.searchParams;
    const godownId   = sp.get("godown_id")  ? parseInt(sp.get("godown_id")!)  : null;
    const productId  = sp.get("product_id") ? parseInt(sp.get("product_id")!) : null;
    const dateFrom   = sp.get("date_from") || null;
    const dateTo     = sp.get("date_to")   || null;

    // Scope by city for city_admin
    const cityId = user.role === "city_admin" ? user.cityId! : null;

    const rows: any[] = await prisma.$queryRaw`
      WITH movements AS (

        -- 1. ALLOCATION IN — stock assigned to a godown from a lot (includes OLD-STOCK legacy lot)
        SELECT
          lcga.created_at                          AS date,
          'allocation'                             AS type,
          l.lot_number                             AS reference,
          lcd.product_id,
          p.name                                   AS product_name,
          lcga.godown_id,
          g.name                                   AS godown_name,
          g.city_id,
          c.name                                   AS city_name,
          lcga.qty                                 AS qty_in,
          0                                        AS qty_out
        FROM lot_city_godown_allocations lcga
        JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
        JOIN lots l    ON l.id  = lcd.lot_id
        JOIN products p ON p.id = lcd.product_id
        JOIN godowns g  ON g.id = lcga.godown_id
        JOIN cities c   ON c.id = g.city_id

        UNION ALL

        -- 3. SALE OUT
        SELECT
          s.sale_date                              AS date,
          'sale'                                   AS type,
          s.voucher_no                             AS reference,
          si.product_id,
          p.name                                   AS product_name,
          s.godown_id,
          g.name                                   AS godown_name,
          g.city_id,
          c.name                                   AS city_name,
          0                                        AS qty_in,
          si.qty                                   AS qty_out
        FROM sale_items si
        JOIN sales s   ON s.id  = si.sale_id AND s.status IN ('active','marked_short')
        JOIN products p ON p.id = si.product_id
        JOIN godowns g  ON g.id = s.godown_id
        JOIN cities c   ON c.id = g.city_id

        UNION ALL

        -- 4. GODOWN TRANSFER OUT (within city)
        SELECT
          gt.transfer_date                         AS date,
          'godown_out'                             AS type,
          CONCAT('GT-', gt.id)                     AS reference,
          gt.product_id,
          p.name                                   AS product_name,
          gt.from_godown_id                        AS godown_id,
          gf.name                                  AS godown_name,
          gf.city_id,
          c.name                                   AS city_name,
          0                                        AS qty_in,
          gt.qty                                   AS qty_out
        FROM godown_transfers gt
        JOIN products p ON p.id = gt.product_id
        JOIN godowns gf ON gf.id = gt.from_godown_id
        JOIN cities c   ON c.id = gf.city_id

        UNION ALL

        -- 5. GODOWN TRANSFER IN (within city)
        SELECT
          gt.transfer_date                         AS date,
          'godown_in'                              AS type,
          CONCAT('GT-', gt.id)                     AS reference,
          gt.product_id,
          p.name                                   AS product_name,
          gt.to_godown_id                          AS godown_id,
          gt2.name                                 AS godown_name,
          gt2.city_id,
          c.name                                   AS city_name,
          gt.qty                                   AS qty_in,
          0                                        AS qty_out
        FROM godown_transfers gt
        JOIN products p  ON p.id  = gt.product_id
        JOIN godowns gt2 ON gt2.id = gt.to_godown_id
        JOIN cities c    ON c.id  = gt2.city_id

        UNION ALL

        -- 6. CITY TRANSFER OUT (approved — deducted from sending godown)
        SELECT
          COALESCE(ct.approved_at, ct.transfer_date) AS date,
          'city_out'                               AS type,
          CONCAT('CTR-', ct.id)                    AS reference,
          ct.product_id,
          p.name                                   AS product_name,
          ct.from_godown_id                        AS godown_id,
          gf.name                                  AS godown_name,
          gf.city_id,
          c.name                                   AS city_name,
          0                                        AS qty_in,
          ct.qty                                   AS qty_out
        FROM city_transfers ct
        JOIN products p ON p.id  = ct.product_id
        JOIN godowns gf ON gf.id = ct.from_godown_id
        JOIN cities c   ON c.id  = gf.city_id
        WHERE ct.status = 'approved'

        UNION ALL

        -- 7. CITY TRANSFER IN (approved — added to receiving godown)
        SELECT
          COALESCE(ct.approved_at, ct.transfer_date) AS date,
          'city_in'                                AS type,
          CONCAT('CTR-', ct.id)                    AS reference,
          ct.product_id,
          p.name                                   AS product_name,
          ct.to_godown_id                          AS godown_id,
          gr.name                                  AS godown_name,
          gr.city_id,
          c.name                                   AS city_name,
          ct.qty                                   AS qty_in,
          0                                        AS qty_out
        FROM city_transfers ct
        JOIN products p ON p.id  = ct.product_id
        JOIN godowns gr ON gr.id = ct.to_godown_id
        JOIN cities c   ON c.id  = gr.city_id
        WHERE ct.status = 'approved' AND ct.to_godown_id IS NOT NULL

      )
      SELECT *
      FROM (
        SELECT
          movements.*,
          SUM(qty_in - qty_out) OVER (
            PARTITION BY godown_id, product_id
            ORDER BY date ASC, reference ASC, type ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS running_stock
        FROM movements
      ) movement_rows
      WHERE
        (${godownId}::int IS NULL OR godown_id = ${godownId})
        AND (${productId}::int IS NULL OR product_id = ${productId})
        AND (${cityId}::int IS NULL OR city_id = ${cityId})
        AND (${dateFrom}::date IS NULL OR date >= ${dateFrom}::date)
        AND (${dateTo}::date IS NULL OR date <= ${dateTo}::date)
      ORDER BY date ASC, reference ASC, type ASC
      LIMIT 500
    `;

    return successResponse(rows.map((r) => ({
      date:        r.date instanceof Date ? r.date.toISOString().split("T")[0] : String(r.date).split("T")[0],
      type:        r.type,
      reference:   r.reference,
      productId:   r.product_id,
      productName: r.product_name,
      godownId:    r.godown_id,
      godownName:  r.godown_name,
      cityName:    r.city_name,
      qtyIn:       Math.round(Number(r.qty_in)  * 100) / 100,
      qtyOut:      Math.round(Number(r.qty_out) * 100) / 100,
      runningStock: Math.round(Number((r as any).running_stock || 0) * 100) / 100,
    })));
  } catch (error) {
    console.error("Stock ledger error:", error);
    return serverError();
  }
});
