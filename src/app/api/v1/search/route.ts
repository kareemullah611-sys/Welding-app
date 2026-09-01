import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, getCityScope } from "@/lib/middleware";
import { successResponse, validationError, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const q = searchParams.get("q");
    if (!q || q.length < 2) return validationError("Search query must be at least 2 characters");

    const type = searchParams.get("type") || "all";
    const cityId = getCityScope(user, searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);
    const take = 10;

    const results: any = {};

    if (type === "all" || type === "customers") {
      const where: any = { name: { contains: q, mode: "insensitive" } };
      if (cityId) where.cityId = cityId;
      results.customers = (await prisma.customer.findMany({
        where, take,
        include: { city: { select: { id: true, name: true } } },
      })).map((c) => ({ id: c.id, name: c.name, city: c.city.name, phone: c.phone }));
    }

    if (type === "all" || type === "sales") {
      const where: any = {
        OR: [
          { voucherNo: { contains: q, mode: "insensitive" } },
          { customer: { name: { contains: q, mode: "insensitive" } } },
          { notes: { contains: q, mode: "insensitive" } },
        ],
      };
      if (cityId) where.cityId = cityId;
      results.sales = (await prisma.sale.findMany({
        where, take,
        include: {
          customer: { select: { name: true } },
          currency: { select: { code: true, symbol: true } },
        },
      })).map((s) => ({
        id: s.id, voucherNo: s.voucherNo, customer: s.customer.name,
        amount: Number(s.totalAmount), currency: s.currency.code,
        date: s.saleDate.toISOString().split("T")[0], status: s.status,
      }));
    }

    if (type === "all" || type === "payments") {
      const where: any = {
        OR: [
          { detail: { contains: q, mode: "insensitive" } },
          { manualVoucherNo: { contains: q, mode: "insensitive" } },
          { customer: { name: { contains: q, mode: "insensitive" } } },
        ],
      };
      if (cityId) where.cityId = cityId;
      results.payments = (await prisma.payment.findMany({
        where, take,
        include: {
          customer: { select: { name: true } },
          currency: { select: { code: true, symbol: true } },
        },
      })).map((p) => ({
        id: p.id, detail: p.detail, customer: p.customer.name,
        amount: Number(p.amount), currency: p.currency.code,
        date: p.paymentDate.toISOString().split("T")[0], status: p.status,
      }));
    }

    if (type === "all" || type === "lots") {
      const where: any = {
        OR: [
          { lotNumber: { contains: q, mode: "insensitive" } },
          { notes: { contains: q, mode: "insensitive" } },
        ],
      };
      if (user.role === "city_admin") {
        where.countryId = user.countryId;
        where.lotCityDistributions = { some: { cityId: user.cityId } };
      }
      results.lots = (await prisma.lot.findMany({
        where, take,
        include: { country: { select: { name: true, code: true } } },
      })).map((l) => ({
        id: l.id, lotNumber: l.lotNumber, country: l.country.name,
        date: l.lotDate.toISOString().split("T")[0], status: l.status,
      }));
    }

    if (type === "all" || type === "products") {
      results.products = (await prisma.product.findMany({
        where: { name: { contains: q, mode: "insensitive" } }, take,
      })).map((p) => ({ id: p.id, name: p.name, isActive: p.isActive }));
    }

    if (type === "all" || type === "haji_transfers") {
      const where: any = {
        OR: [
          { detail: { contains: q, mode: "insensitive" } },
          { notes: { contains: q, mode: "insensitive" } },
        ],
      };
      if (cityId) where.cityId = cityId;
      results.haji_transfers = (await prisma.hajiTransfer.findMany({
        where, take,
        include: { currency: { select: { code: true, symbol: true } }, lot: { select: { lotNumber: true } }, city: { select: { name: true } } },
      })).map((h) => ({
        id: h.id, detail: h.detail, amount: Number(h.amount), currency: h.currency.code,
        date: h.transferDate.toISOString().split("T")[0], transferType: h.transferType,
        lotNumber: h.lot?.lotNumber ?? null, city: h.city.name,
      }));
    }

    if (type === "all" || type === "expenses") {
      const where: any = {
        OR: [
          { detail: { contains: q, mode: "insensitive" } },
          { notes: { contains: q, mode: "insensitive" } },
        ],
      };
      if (cityId) where.cityId = cityId;
      results.expenses = (await prisma.expense.findMany({
        where, take,
        include: { currency: { select: { code: true, symbol: true } }, lot: { select: { lotNumber: true } }, city: { select: { name: true } } },
      })).map((e) => ({
        id: e.id, detail: e.detail, amount: Number(e.amount), currency: e.currency.code,
        date: e.expenseDate.toISOString().split("T")[0], lotNumber: e.lot?.lotNumber ?? null, city: e.city.name,
      }));
    }

    return successResponse(results);
  } catch (error) {
    console.error("Search error:", error);
    return serverError();
  }
});
