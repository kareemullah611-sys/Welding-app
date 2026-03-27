import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// ─── POST /api/v1/investors/[id]/transactions ──────────────────────────────
// Body: { type: "deposit"|"withdrawal"|"profit", accountId, amount, date, notes, periodStart?, periodEnd? }
export const POST = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const investorId = parseInt(context.params.id);
    const body = await request.json();
    const { type, accountId, amount, date, notes, periodStart, periodEnd } = body;

    if (!type || !accountId || !amount || !date) return errorResponse("VALIDATION", "type, accountId, amount, date are required", 400);
    if (parseFloat(amount) <= 0) return errorResponse("VALIDATION", "Amount must be greater than 0", 400);

    // Verify account belongs to this investor
    const account = await prisma.investorAccount.findFirst({ where: { id: parseInt(accountId), investorId } });
    if (!account) return errorResponse("NOT_FOUND", "Account not found", 404);

    if (type === "deposit") {
      const record = await prisma.investorDeposit.create({
        data: {
          accountId: parseInt(accountId),
          amount: parseFloat(amount),
          depositDate: new Date(date),
          notes: notes?.trim() || null,
          createdBy: user.userId,
        },
      });
      return successResponse(record, "Deposit recorded", 201);
    }

    if (type === "withdrawal") {
      // Validate capital won't go negative
      const [deposits, withdrawals] = await Promise.all([
        prisma.investorDeposit.aggregate({ where: { accountId: parseInt(accountId) }, _sum: { amount: true } }),
        prisma.investorWithdrawal.aggregate({ where: { accountId: parseInt(accountId) }, _sum: { amount: true } }),
      ]);
      const capital = Number(deposits._sum.amount ?? 0) - Number(withdrawals._sum.amount ?? 0);
      if (parseFloat(amount) > capital) {
        return errorResponse("VALIDATION", `Withdrawal amount (${amount}) exceeds available capital (${capital})`, 400);
      }
      const record = await prisma.investorWithdrawal.create({
        data: {
          accountId: parseInt(accountId),
          amount: parseFloat(amount),
          withdrawalDate: new Date(date),
          notes: notes?.trim() || null,
          createdBy: user.userId,
        },
      });
      return successResponse(record, "Withdrawal recorded", 201);
    }

    if (type === "profit") {
      if (!periodStart || !periodEnd) return errorResponse("VALIDATION", "periodStart and periodEnd are required for profit allocation", 400);
      const record = await prisma.profitAllocation.create({
        data: {
          accountId: parseInt(accountId),
          amount: parseFloat(amount),
          allocationDate: new Date(date),
          periodStart: new Date(periodStart),
          periodEnd: new Date(periodEnd),
          notes: notes?.trim() || null,
          createdBy: user.userId,
        },
      });
      return successResponse(record, "Profit allocated", 201);
    }

    return errorResponse("VALIDATION", "type must be deposit, withdrawal, or profit", 400);
  } catch (e) {
    console.error(e);
    return serverError();
  }
});

// ─── DELETE /api/v1/investors/[id]/transactions ────────────────────────────
// Body: { type, transactionId }
export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const body = await request.json();
    const { type, transactionId } = body;

    if (type === "deposit") {
      await prisma.investorDeposit.delete({ where: { id: parseInt(transactionId) } });
    } else if (type === "withdrawal") {
      await prisma.investorWithdrawal.delete({ where: { id: parseInt(transactionId) } });
    } else if (type === "profit") {
      await prisma.profitAllocation.delete({ where: { id: parseInt(transactionId) } });
    } else {
      return errorResponse("VALIDATION", "Invalid type", 400);
    }

    return successResponse(null, "Transaction deleted");
  } catch (e) {
    console.error(e);
    return serverError();
  }
});
