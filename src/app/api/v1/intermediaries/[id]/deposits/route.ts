import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { journalIntermediaryDeposit } from "@/lib/accounting";
import { JWTPayload } from "@/lib/auth";

export const POST = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  const intermediaryId = parseInt(context.params.id);
  const body = await request.json();

  if (!body.depositDate) return Response.json({ error: "depositDate required" }, { status: 400 });
  if (!body.amount || Number(body.amount) <= 0) return Response.json({ error: "amount must be > 0" }, { status: 400 });
  if (!body.currencyId) return Response.json({ error: "currencyId required" }, { status: 400 });
  if (!body.sourceType) return Response.json({ error: "sourceType required" }, { status: 400 });

  const currency = await prisma.currency.findUnique({ where: { id: Number(body.currencyId) } });
  if (!currency) return Response.json({ error: "Invalid currency" }, { status: 400 });

  const deposit = await prisma.intermediaryDeposit.create({
    data: {
      intermediaryId,
      depositDate: new Date(body.depositDate),
      amount: Number(body.amount),
      currencyId: Number(body.currencyId),
      sourceType: body.sourceType,
      cityId: body.cityId ? Number(body.cityId) : null,
      bankAccountId: body.bankAccountId ? Number(body.bankAccountId) : null,
      notes: body.notes || null,
      createdBy: user.userId,
    },
  });

  await journalIntermediaryDeposit({
    id: deposit.id, intermediaryId,
    amount: Number(deposit.amount), currencyCode: currency.code,
    depositDate: deposit.depositDate, createdBy: user.userId,
    sourceType: body.sourceType,
    cityId: body.cityId ? Number(body.cityId) : null,
    bankAccountId: body.bankAccountId ? Number(body.bankAccountId) : null,
  });

  return Response.json(deposit, { status: 201 });
});
