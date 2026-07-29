import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET /api/v1/cash-position?city_id=1
// Returns: total payments in (by method), expenses out, withdrawals out, haji transfers out = net cash in hand
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const searchParams = request.nextUrl.searchParams;
    const cityId = user.role === "city_admin" ? user.cityId! : (searchParams.get("city_id") ? parseInt(searchParams.get("city_id")!) : undefined);

    const cityFilter = cityId ? { cityId } : {};
    const inHandFilter = { ...cityFilter, status: "active" as const, destination: "our_account" as const };
    const hajiDirectFilter = { ...cityFilter, status: "active" as const, destination: "haji" as const };

    // Payments received (to our_account = in-hand)
    const [cashIn, chequeIn, bankIn, onlineIn, openingCash] = await Promise.all([
      prisma.payment.aggregate({ where: { ...inHandFilter, paymentMethod: "cash" }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: { ...inHandFilter, paymentMethod: "cheque", chequeStatus: "in_hand" as any }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: { ...inHandFilter, paymentMethod: "bank_transfer" }, _sum: { amount: true } }),
      prisma.payment.aggregate({ where: { ...inHandFilter, paymentMethod: "online" }, _sum: { amount: true } }),
      prisma.openingCash.aggregate({ where: cityFilter, _sum: { amount: true } }),
    ]);

    // Payments direct to Haji (not in-hand)
    const hajiDirect = await prisma.payment.aggregate({ where: hajiDirectFilter, _sum: { amount: true } });

    // Money going OUT from in-hand (exclude soft-deleted expenses)
    const [expenses, withdrawals, hajiTransfers] = await Promise.all([
      prisma.expense.aggregate({ where: { ...cityFilter, deletedAt: null }, _sum: { amount: true } }),
      prisma.personalWithdrawal.aggregate({ where: { ...cityFilter, approvedAt: { not: null } }, _sum: { amount: true } }),
      prisma.hajiTransfer.aggregate({ where: { ...cityFilter, transferType: "from_in_hand" } as any, _sum: { amount: true } }),
    ]);

    const totalInHand = Number(openingCash._sum.amount || 0) + Number(cashIn._sum.amount || 0) + Number(chequeIn._sum.amount || 0) + Number(bankIn._sum.amount || 0) + Number(onlineIn._sum.amount || 0);
    const totalOut = Number(expenses._sum.amount || 0) + Number(withdrawals._sum.amount || 0) + Number(hajiTransfers._sum.amount || 0);

    return successResponse({
      incomingToHand: {
        opening: Number(openingCash._sum.amount || 0),
        cash: Number(cashIn._sum.amount || 0),
        cheque: Number(chequeIn._sum.amount || 0),
        bankTransfer: Number(bankIn._sum.amount || 0),
        online: Number(onlineIn._sum.amount || 0),
        total: totalInHand,
      },
      directToHaji: Number(hajiDirect._sum.amount || 0),
      outgoing: {
        expenses: Number(expenses._sum.amount || 0),
        personalWithdrawals: Number(withdrawals._sum.amount || 0),
        hajiTransfers: Number(hajiTransfers._sum.amount || 0),
        total: totalOut,
      },
      netCashInHand: Math.round((totalInHand - totalOut) * 100) / 100,
    });
  } catch (error) {
    console.error("Cash position error:", error);
    return serverError();
  }
});
