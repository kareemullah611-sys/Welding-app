import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/payments/check-voucher?voucher_no=XXX
// Returns existing active payment(s) with the same voucher no in the same city
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const voucherNo = request.nextUrl.searchParams.get("voucher_no")?.trim();
    if (!voucherNo) return errorResponse("VALIDATION_ERROR", "voucher_no is required");

    const cityId = user.cityId ?? undefined;

    const existing = await prisma.payment.findMany({
      where: {
        manualVoucherNo: voucherNo,
        status: "active",
        ...(cityId ? { cityId } : {}),
      },
      include: {
        customer: { select: { id: true, name: true } },
        currency: { select: { code: true, symbol: true } },
      },
      orderBy: { paymentDate: "desc" },
      take: 5,
    });

    return successResponse({
      isDuplicate: existing.length > 0,
      matches: existing.map((p) => ({
        id: p.id,
        paymentDate: p.paymentDate.toISOString().split("T")[0],
        customerName: p.customer.name,
        amount: Number(p.amount),
        currencySymbol: p.currency.symbol,
        currencyCode: p.currency.code,
        detail: p.detail,
        paymentMethod: p.paymentMethod,
      })),
    });
  } catch (error) {
    console.error("Check voucher error:", error);
    return serverError();
  }
});
