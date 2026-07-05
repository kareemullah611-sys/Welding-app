import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);

    const inventory: any[] = await prisma.$queryRaw`
      WITH received AS (
        SELECT lcga.godown_id, lcd.product_id, COALESCE(SUM(lcga.qty), 0) as qty
        FROM lot_city_godown_allocations lcga
        JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
        JOIN godowns g ON g.id = lcga.godown_id
        WHERE (${cityId}::int IS NULL OR g.city_id = ${cityId})
        GROUP BY lcga.godown_id, lcd.product_id
      ),
      sold AS (
        SELECT s.godown_id, si.product_id, COALESCE(SUM(si.qty), 0) as qty
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id AND s.status IN ('active', 'marked_short')
        WHERE (${cityId}::int IS NULL OR s.city_id = ${cityId})
        GROUP BY s.godown_id, si.product_id
      ),
      transferred_out AS (
        SELECT gt.from_godown_id as godown_id, gt.product_id, COALESCE(SUM(gt.qty), 0) as qty
        FROM godown_transfers gt
        JOIN godowns g ON g.id = gt.from_godown_id
        WHERE (${cityId}::int IS NULL OR g.city_id = ${cityId})
        GROUP BY gt.from_godown_id, gt.product_id
      ),
      transferred_in AS (
        SELECT gt.to_godown_id as godown_id, gt.product_id, COALESCE(SUM(gt.qty), 0) as qty
        FROM godown_transfers gt
        JOIN godowns g ON g.id = gt.to_godown_id
        WHERE (${cityId}::int IS NULL OR g.city_id = ${cityId})
        GROUP BY gt.to_godown_id, gt.product_id
      )
      SELECT
        g.id as godown_id, g.name as godown_name, c.id as city_id, c.name as city_name,
        co.id as country_id, co.name as country_name,
        p.id as product_id, p.name as product_name,
        p.unit_of_measure, p.pieces_per_carton,
        (COALESCE(r.qty, 0) - COALESCE(s.qty, 0) - COALESCE(tout.qty, 0) + COALESCE(tin.qty, 0)) as qty
      FROM godowns g
      JOIN cities c ON c.id = g.city_id
      JOIN countries co ON co.id = c.country_id
      CROSS JOIN products p
      LEFT JOIN received r ON r.godown_id = g.id AND r.product_id = p.id
      LEFT JOIN sold s ON s.godown_id = g.id AND s.product_id = p.id
      LEFT JOIN transferred_out tout ON tout.godown_id = g.id AND tout.product_id = p.id
      LEFT JOIN transferred_in tin ON tin.godown_id = g.id AND tin.product_id = p.id
      WHERE g.is_active = true AND p.is_active = true
        AND (${cityId}::int IS NULL OR g.city_id = ${cityId})
      ORDER BY g.name, p.name
    `;

    const productTotals: Record<string, any> = {};
    const countryTotals: Record<string, any> = {};
    const cityTotals: Record<string, any> = {};
    const godownTotals: Record<string, any> = {};
    const detailed: Record<string, any> = {};
    let grandTotal = 0;

    for (const row of inventory) {
      const baseQty = Number(row.qty);
      const qty = row.unit_of_measure === "PCS" && Number(row.pieces_per_carton || 0) > 0
        ? baseQty / Number(row.pieces_per_carton)
        : baseQty;
      if (qty === 0) continue;
      grandTotal += qty;

      if (!productTotals[row.product_id]) productTotals[row.product_id] = { productId: row.product_id, productName: row.product_name, unitOfMeasure: row.unit_of_measure, piecesPerCarton: row.pieces_per_carton, totalQty: 0 };
      productTotals[row.product_id].totalQty += qty;

      if (!countryTotals[row.country_id]) countryTotals[row.country_id] = { countryId: row.country_id, countryName: row.country_name, totalQty: 0 };
      countryTotals[row.country_id].totalQty += qty;

      if (!cityTotals[row.city_id]) cityTotals[row.city_id] = { cityId: row.city_id, cityName: row.city_name, countryName: row.country_name, totalQty: 0 };
      cityTotals[row.city_id].totalQty += qty;

      if (!godownTotals[row.godown_id]) godownTotals[row.godown_id] = { godownId: row.godown_id, godownName: row.godown_name, cityName: row.city_name, totalQty: 0 };
      godownTotals[row.godown_id].totalQty += qty;

      if (!detailed[row.godown_id]) detailed[row.godown_id] = { godownId: row.godown_id, godownName: row.godown_name, cityId: row.city_id, cityName: row.city_name, countryId: row.country_id, countryName: row.country_name, totalQty: 0, products: [] };
      detailed[row.godown_id].totalQty += qty;
      detailed[row.godown_id].products.push({ productId: row.product_id, productName: row.product_name, unitOfMeasure: row.unit_of_measure, piecesPerCarton: row.pieces_per_carton, qty: Math.round(qty * 100) / 100 });
    }

    return successResponse({
      grandTotalQty: Math.round(grandTotal * 100) / 100,
      countrySummary: Object.values(countryTotals).map((c: any) => ({ ...c, totalQty: Math.round(c.totalQty * 100) / 100 })),
      citySummary: Object.values(cityTotals).map((c: any) => ({ ...c, totalQty: Math.round(c.totalQty * 100) / 100 })),
      productsSummary: Object.values(productTotals).map((p: any) => ({ ...p, totalQty: Math.round(p.totalQty * 100) / 100 })),
      godownsSummary: Object.values(godownTotals).map((g: any) => ({ ...g, totalQty: Math.round(g.totalQty * 100) / 100 })),
      detailed: Object.values(detailed),
    });
  } catch (error) {
    console.error("Inventory error:", error);
    return serverError();
  }
});
