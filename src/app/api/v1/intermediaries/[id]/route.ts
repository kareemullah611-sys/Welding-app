import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth, withSuperAdmin } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";

export const GET = withAuth(async (_request: NextRequest, context: any, _user: JWTPayload) => {
  const id = parseInt(context.params.id);
  const intermediary = await prisma.intermediary.findUnique({ where: { id } });
  if (!intermediary) return Response.json({ error: "Not found" }, { status: 404 });

  const [deposits, payments] = await Promise.all([
    prisma.intermediaryDeposit.findMany({
      where: { intermediaryId: id },
      include: { currency: true, city: true, bankAccount: true, creator: { select: { fullName: true } } },
      orderBy: { depositDate: "asc" },
    }),
    prisma.supplierPayment.findMany({
      where: { intermediaryId: id },
      include: { supplier: true, creator: { select: { fullName: true } } },
      orderBy: { paymentDate: "asc" },
    }),
  ]);

  type LedgerEntry = {
    date: Date; type: "deposit" | "payment"; id: number;
    description: string; currencyCode: string; debit: number; credit: number;
  };

  const entries: LedgerEntry[] = [
    ...deposits.map((d) => ({
      date: d.depositDate, type: "deposit" as const, id: d.id,
      description: `Deposit${d.city ? ` (${d.city.name})` : ""}${d.bankAccount ? ` via ${d.bankAccount.bankName}` : ""}${d.notes ? ` — ${d.notes}` : ""}`,
      currencyCode: d.currency.code, debit: Number(d.amount), credit: 0,
    })),
    ...payments.map((p) => ({
      date: p.paymentDate, type: "payment" as const, id: p.id,
      description: `Supplier payment — ${p.supplier.name}${p.notes ? ` — ${p.notes}` : ""}`,
      currencyCode: "USD", debit: 0, credit: Number(p.amountUsd),
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const balances: Record<string, number> = {};
  const ledger = entries.map((e) => {
    balances[e.currencyCode] = (balances[e.currencyCode] || 0) + e.debit - e.credit;
    return { ...e, balance: balances[e.currencyCode] };
  });

  return Response.json({ intermediary, ledger, balances });
});

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, _user: JWTPayload) => {
  const id = parseInt(context.params.id);
  const body = await request.json();

  const updated = await prisma.intermediary.update({
    where: { id },
    data: {
      name: body.name?.trim() || undefined,
      notes: body.notes !== undefined ? body.notes || null : undefined,
      isActive: body.isActive !== undefined ? body.isActive : undefined,
    },
  });
  return Response.json(updated);
});
