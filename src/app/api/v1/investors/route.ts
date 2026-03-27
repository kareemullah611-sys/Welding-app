import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, paginatedResponse, errorResponse, serverError, getPaginationParams } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// ─── GET /api/v1/investors ─────────────────────────────────────────────────
export const GET = withAuth(async (request: NextRequest, _ctx, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const sp = request.nextUrl.searchParams;
    const { page, limit, skip } = getPaginationParams(sp);

    const [investors, total] = await Promise.all([
      prisma.investor.findMany({
        where: { isActive: true },
        include: {
          accounts: {
            where: { isActive: true },
            include: { currency: true },
          },
        },
        orderBy: { name: "asc" },
        skip,
        take: limit,
      }),
      prisma.investor.count({ where: { isActive: true } }),
    ]);

    // Compute balance per account
    const enriched = await Promise.all(
      investors.map(async (inv) => {
        const accounts = await Promise.all(
          inv.accounts.map(async (acc) => {
            const [deposits, withdrawals, profits] = await Promise.all([
              prisma.investorDeposit.aggregate({ where: { accountId: acc.id }, _sum: { amount: true } }),
              prisma.investorWithdrawal.aggregate({ where: { accountId: acc.id }, _sum: { amount: true } }),
              prisma.profitAllocation.aggregate({ where: { accountId: acc.id }, _sum: { amount: true } }),
            ]);
            const totalDeposits = Number(deposits._sum.amount ?? 0);
            const totalWithdrawals = Number(withdrawals._sum.amount ?? 0);
            const totalProfits = Number(profits._sum.amount ?? 0);
            const capital = totalDeposits - totalWithdrawals;
            const balance = capital + totalProfits;
            return {
              id: acc.id,
              profitType: acc.profitType,
              fixedRatePercent: acc.fixedRatePercent ? Number(acc.fixedRatePercent) : null,
              profitSharePercent: acc.profitSharePercent ? Number(acc.profitSharePercent) : null,
              startDate: acc.startDate.toISOString().split("T")[0],
              currency: acc.currency,
              totalDeposits,
              totalWithdrawals,
              capital,
              totalProfits,
              balance,
            };
          })
        );
        return {
          id: inv.id,
          name: inv.name,
          relationship: inv.relationship,
          phone: inv.phone,
          notes: inv.notes,
          isActive: inv.isActive,
          accounts,
        };
      })
    );

    return paginatedResponse(enriched, total, page, limit);
  } catch (e) {
    console.error(e);
    return serverError();
  }
});

// ─── POST /api/v1/investors ────────────────────────────────────────────────
export const POST = withAuth(async (request: NextRequest, _ctx, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const body = await request.json();
    const { name, relationship, phone, notes, currencyId, profitType, fixedRatePercent, profitSharePercent, startDate, initialDeposit } = body;

    if (!name?.trim()) return errorResponse("VALIDATION", "Name is required", 400);
    if (!currencyId) return errorResponse("VALIDATION", "Currency is required", 400);
    if (!startDate) return errorResponse("VALIDATION", "Start date is required", 400);
    if (profitType === "fixed_rate" && !fixedRatePercent) return errorResponse("VALIDATION", "Fixed rate % is required", 400);
    if (profitType === "profit_share" && !profitSharePercent) return errorResponse("VALIDATION", "Profit share % is required", 400);

    const investor = await prisma.investor.create({
      data: {
        name: name.trim(),
        relationship: relationship?.trim() || null,
        phone: phone?.trim() || null,
        notes: notes?.trim() || null,
        createdBy: user.userId,
        accounts: {
          create: {
            currencyId: parseInt(currencyId),
            profitType,
            fixedRatePercent: profitType === "fixed_rate" ? parseFloat(fixedRatePercent) : null,
            profitSharePercent: profitType === "profit_share" ? parseFloat(profitSharePercent) : null,
            startDate: new Date(startDate),
            createdBy: user.userId,
            ...(initialDeposit && parseFloat(initialDeposit) > 0
              ? {
                  deposits: {
                    create: {
                      amount: parseFloat(initialDeposit),
                      depositDate: new Date(startDate),
                      notes: "Initial deposit",
                      createdBy: user.userId,
                    },
                  },
                }
              : {}),
          },
        },
      },
      include: { accounts: { include: { currency: true } } },
    });

    return successResponse(investor, "Investor created successfully", 201);
  } catch (e) {
    console.error(e);
    return serverError();
  }
});
