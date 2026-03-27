import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/discounts
// Returns discount history with customer, sale, lot, and currency details.
export const GET = withAuth(async (request: NextRequest, _context: any, user: JWTPayload) => {
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom  = searchParams.get("date_from");
    const dateTo    = searchParams.get("date_to");
    const cityId    = searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : null;
    const customerId = searchParams.get("customer_id") ? parseInt(searchParams.get("customer_id")!) : null;

    const where: any = {};

    // Scope city_admin to their own city only
    if (user.role === "city_admin" && user.cityId) {
      where.sale = { cityId: user.cityId };
    } else if (cityId) {
      where.sale = { cityId };
    }

    if (customerId) {
      where.sale = { ...(where.sale || {}), customerId };
    }

    if (dateFrom || dateTo) {
      where.discountDate = {};
      if (dateFrom) where.discountDate.gte = new Date(dateFrom);
      if (dateTo)   where.discountDate.lte = new Date(dateTo + "T23:59:59");
    }

    const discounts = await prisma.saleDiscount.findMany({
      where,
      include: {
        sale: {
          select: {
            id:         true,
            voucherNo:  true,
            saleDate:   true,
            customer:   { select: { id: true, name: true } },
            city:       { select: { id: true, name: true } },
          },
        },
        currency:     { select: { code: true, symbol: true } },
        appliedToLot: { select: { id: true, lotNumber: true } },
        creator:      { select: { username: true } },
      },
      orderBy: { discountDate: "desc" },
    });

    const formatted = discounts.map((d) => ({
      id:             d.id,
      discountDate:   d.discountDate.toISOString().split("T")[0],
      customer:       d.sale.customer,
      saleVoucherNo:  d.sale.voucherNo,
      saleDate:       d.sale.saleDate.toISOString().split("T")[0],
      saleId:         d.sale.id,
      city:           d.sale.city,
      lotNumber:      d.appliedToLot.lotNumber,
      discountAmount: Number(d.discountAmount),
      currency:       d.currency,
      notes:          d.notes || "",
      createdBy:      d.creator.username,
    }));

    const totalByCurrency: Record<string, number> = {};
    for (const d of formatted) {
      const code = d.currency.code;
      totalByCurrency[code] = (totalByCurrency[code] || 0) + d.discountAmount;
    }

    return NextResponse.json({
      success: true,
      data: formatted,
      message: "Discounts retrieved",
      pagination: {
        page: 1,
        limit: formatted.length,
        total: formatted.length,
        totalPages: 1,
        totalByCurrency,
      },
    });
  } catch (error) {
    console.error("Discounts API error:", error);
    return serverError();
  }
});
