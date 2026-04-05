import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// ─── GET /api/v1/investors/[id] — full ledger ─────────────────────────────
export const GET = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const id = parseInt(context.params.id);
    const investor = await prisma.investor.findUnique({
      where: { id },
      include: {
        accounts: {
          include: {
            currency: true,
            deposits: { orderBy: { depositDate: "asc" } },
            withdrawals: { orderBy: { withdrawalDate: "asc" } },
            profitAllocations: { orderBy: { allocationDate: "asc" } },
          },
        },
      },
    });

    if (!investor) return errorResponse("NOT_FOUND", "Investor not found", 404);

    // Build ledger entries (merged + sorted by date)
    const accounts = investor.accounts.map((acc) => {
      type LedgerEntry = {
        id: number;
        type: "deposit" | "withdrawal" | "profit";
        date: string;
        amount: number;
        notes: string | null;
        runningCapital: number;
        runningBalance: number;
      };

      const entries: LedgerEntry[] = [];

      for (const d of acc.deposits) {
        entries.push({ id: d.id, type: "deposit", date: d.depositDate.toISOString().split("T")[0], amount: Number(d.amount), notes: d.notes, runningCapital: 0, runningBalance: 0 });
      }
      for (const w of acc.withdrawals) {
        entries.push({ id: w.id, type: "withdrawal", date: w.withdrawalDate.toISOString().split("T")[0], amount: Number(w.amount), notes: w.notes, runningCapital: 0, runningBalance: 0 });
      }
      for (const p of acc.profitAllocations) {
        entries.push({ id: p.id, type: "profit", date: p.allocationDate.toISOString().split("T")[0], amount: Number(p.amount), notes: p.notes, runningCapital: 0, runningBalance: 0 });
      }

      // Sort by date
      entries.sort((a, b) => a.date.localeCompare(b.date));

      // Compute running totals
      let capital = 0;
      let balance = 0;
      for (const e of entries) {
        if (e.type === "deposit") { capital += e.amount; balance += e.amount; }
        else if (e.type === "withdrawal") { capital -= e.amount; balance -= e.amount; }
        else if (e.type === "profit") { balance += e.amount; }
        e.runningCapital = capital;
        e.runningBalance = balance;
      }

      const totalDeposits = acc.deposits.reduce((s, d) => s + Number(d.amount), 0);
      const totalWithdrawals = acc.withdrawals.reduce((s, w) => s + Number(w.amount), 0);
      const totalProfits = acc.profitAllocations.reduce((s, p) => s + Number(p.amount), 0);
      const finalCapital = totalDeposits - totalWithdrawals;
      const finalBalance = finalCapital + totalProfits;

      // Projected profit (only for fixed_rate)
      const projectedProfit = acc.profitType === "fixed_rate" && acc.fixedRatePercent
        ? finalCapital * (Number(acc.fixedRatePercent) / 100)
        : null;

      return {
        id: acc.id,
        currency: acc.currency,
        profitType: acc.profitType,
        fixedRatePercent: acc.fixedRatePercent ? Number(acc.fixedRatePercent) : null,
        profitSharePercent: acc.profitSharePercent ? Number(acc.profitSharePercent) : null,
        startDate: acc.startDate.toISOString().split("T")[0],
        totalDeposits,
        totalWithdrawals,
        capital: finalCapital,
        totalProfits,
        balance: finalBalance,
        projectedProfit,
        entries: entries.reverse(),
      };
    });

    return successResponse({
      id: investor.id,
      name: investor.name,
      relationship: investor.relationship,
      phone: investor.phone,
      notes: investor.notes,
      isActive: investor.isActive,
      accounts,
    });
  } catch (e) {
    console.error(e);
    return serverError();
  }
});

// ─── DELETE /api/v1/investors/[id] — delete investor (only if no transactions) ─
export const DELETE = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const id = parseInt(context.params.id);
    const accounts = await prisma.investorAccount.findMany({
      where: { investorId: id },
      include: { _count: { select: { deposits: true, withdrawals: true, profitAllocations: true } } },
    });
    const hasTransactions = accounts.some(
      (a) => a._count.deposits > 0 || a._count.withdrawals > 0 || a._count.profitAllocations > 0
    );
    if (hasTransactions) {
      return errorResponse("CONFLICT", "Cannot delete investor with existing transactions. Deactivate them instead.", 409);
    }
    await prisma.investor.delete({ where: { id } });
    return successResponse(null, "Investor deleted");
  } catch (e) {
    console.error(e);
    return serverError();
  }
});

// ─── PATCH /api/v1/investors/[id] — edit investor info ────────────────────
export const PATCH = withAuth(async (request: NextRequest, context: any, user: JWTPayload) => {
  if (user.role !== "super_admin") return errorResponse("FORBIDDEN", "Super admin only", 403);
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    const { name, relationship, phone, notes, isActive } = body;

    const investor = await prisma.investor.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(relationship !== undefined && { relationship: relationship?.trim() || null }),
        ...(phone !== undefined && { phone: phone?.trim() || null }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    return successResponse(investor);
  } catch (e) {
    console.error(e);
    return serverError();
  }
});
