import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { journalIntermediaryDeposit, reverseJournalEntries } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  const id = parseInt(context.params.id);
  const body = await request.json();

  const existing = await prisma.intermediaryDeposit.findUnique({
    where: { id }, include: { currency: true },
  });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  const currencyId = body.currencyId ? Number(body.currencyId) : existing.currencyId;
  const currency = await prisma.currency.findUnique({ where: { id: currencyId } });
  if (!currency) return Response.json({ error: "Invalid currency" }, { status: 400 });

  await reverseJournalEntries(`INTDEP-${id}`, user.userId);

  const updated = await prisma.intermediaryDeposit.update({
    where: { id },
    data: {
      depositDate: body.depositDate ? new Date(body.depositDate) : undefined,
      amount: body.amount ? Number(body.amount) : undefined,
      currencyId,
      sourceType: body.sourceType || undefined,
      cityId: body.cityId !== undefined ? (body.cityId ? Number(body.cityId) : null) : undefined,
      bankAccountId: body.bankAccountId !== undefined ? (body.bankAccountId ? Number(body.bankAccountId) : null) : undefined,
      notes: body.notes !== undefined ? body.notes || null : undefined,
    },
  });

  await journalIntermediaryDeposit({
    id, intermediaryId: updated.intermediaryId,
    amount: Number(updated.amount), currencyCode: currency.code,
    depositDate: updated.depositDate, createdBy: user.userId,
    sourceType: updated.sourceType,
    cityId: updated.cityId, bankAccountId: updated.bankAccountId,
  });

  return Response.json(updated);
});

export const DELETE = withSuperAdmin(async (_req: NextRequest, context: any, user: JWTPayload) => {
  const id = parseInt(context.params.id);
  const existing = await prisma.intermediaryDeposit.findUnique({ where: { id } });
  if (!existing) return Response.json({ error: "Not found" }, { status: 404 });

  await reverseJournalEntries(`INTDEP-${id}`, user.userId);
  await prisma.intermediaryDeposit.delete({ where: { id } });

  return Response.json({ success: true });
});
