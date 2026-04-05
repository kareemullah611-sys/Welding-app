import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

export const GET = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const agent = await prisma.agent.findUnique({ where: { id }, include: { city: true, lotCosts: { where: { paidFromCash: false }, include: { lot: { select: { lotNumber: true } } }, orderBy: { createdAt: "desc" } }, agentPayments: { orderBy: { paymentDate: "desc" } } } });
    if (!agent) return errorResponse("NOT_FOUND", "Agent not found", 404);

    // Build ledger
    const entries: any[] = [];
    for (const c of agent.lotCosts) { entries.push({ date: c.costDate || c.createdAt, type: "charge", description: `${c.costType}: ${c.description} (Lot ${c.lot.lotNumber})`, debit: Number(c.amount), credit: 0, currency: c.currencyCode }); }
    for (const p of agent.agentPayments) { entries.push({ date: p.paymentDate, type: "payment", description: `Payment ${p.paymentMethod} ${p.reference || ""}`, debit: 0, credit: Number(p.amount), currency: p.currencyCode }); }
    entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    // Per-currency running balances
    const currencyBalances: Record<string, number> = {};
    const ledger = entries.map(e => {
      const ccy = e.currency;
      if (!currencyBalances[ccy]) currencyBalances[ccy] = 0;
      currencyBalances[ccy] += e.debit - e.credit;
      return { ...e, date: new Date(e.date).toISOString().split("T")[0], balance: Math.round(currencyBalances[ccy] * 100) / 100, currency: ccy };
    }).reverse();

    return successResponse({ ...agent, id: agent.id, name: agent.name, ledger });
  } catch (error) { return serverError(); }
});

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const id = parseInt(context.params.id);
    const body = await request.json();
    if (body.agentType === "freight") return errorResponse("VALIDATION_ERROR", "Use Shipping Lines for freight parties");
    await prisma.agent.update({ where: { id }, data: { name: body.name, agentType: body.agentType, phone: body.phone, notes: body.notes } });
    return successResponse({ id }, "Agent updated");
  } catch (error) { return serverError(); }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try { const id = parseInt(context.params.id); await prisma.agent.update({ where: { id }, data: { isActive: false } }); return successResponse({ id }, "Agent deactivated"); }
  catch (error) { return serverError(); }
});
