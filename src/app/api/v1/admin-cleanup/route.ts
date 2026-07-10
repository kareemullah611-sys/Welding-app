import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { withSuperAdmin, getClientIP } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";
import { clientErrorMessage } from "@/lib/client-error";
import crypto from "crypto";

// Hardening for C10: dev-only destructive endpoint that wipes the entire business DB.

const REQUIRED_CONFIRM_PHRASE = "DELETE ALL BUSINESS DATA";

function timingSafeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function adminCleanupGuard(args: {
  requestSecret: string | null | undefined;
  confirm: string | null | undefined;
}): Response | null {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const enabled = process.env.ENABLE_ADMIN_CLEANUP === "true";
  const secret = process.env.ADMIN_CLEANUP_SECRET;

  if (!enabled) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!secret || secret.length < 16) {
    return NextResponse.json(
      { error: "misconfigured", message: "ADMIN_CLEANUP_SECRET must be set to at least 16 characters" },
      { status: 503 },
    );
  }
  if (!args.requestSecret || !timingSafeStringEqual(args.requestSecret, secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (args.confirm !== REQUIRED_CONFIRM_PHRASE) {
    return NextResponse.json(
      { error: "bad_request", message: `confirm field must be exactly "${REQUIRED_CONFIRM_PHRASE}"` },
      { status: 400 },
    );
  }
  return null;
}

async function wipeTestData(tx: Prisma.TransactionClient) {
  await tx.profitAllocation.deleteMany();
  await tx.investorWithdrawal.deleteMany();
  await tx.investorDeposit.deleteMany();
  await tx.investorAccount.deleteMany();
  await tx.investor.deleteMany();
  await tx.journalEntry.deleteMany();
  await tx.auditLog.deleteMany();
  await tx.attachment.deleteMany();
  await tx.saleItem.deleteMany();
  await tx.saleDiscount.deleteMany();
  await tx.paymentLotTransfer.deleteMany();
  await (tx as any).lotSettlementUnresolvedOverflow.deleteMany();
  await tx.lotSettlementOverflow.deleteMany();
  await tx.sale.deleteMany();
  await tx.payment.deleteMany();
  await tx.godownTransfer.deleteMany();
  await tx.cityTransfer.deleteMany();
  await tx.lotCityGodownAllocation.deleteMany();
  await tx.lotCityDistribution.deleteMany();
  await tx.lotProduct.deleteMany();
  await tx.lotCost.deleteMany();
  await tx.lotPurchase.deleteMany();
  await tx.supplierPayment.deleteMany();
  await tx.shippingLinePayment.deleteMany();
  await tx.agentPayment.deleteMany();
  await tx.expense.deleteMany();
  await tx.hajiTransfer.deleteMany();
  await tx.personalWithdrawal.deleteMany();
  await tx.bankDeposit.deleteMany();
  await tx.lot.deleteMany();
  await tx.intermediaryDeposit.deleteMany();
  await tx.intermediary.deleteMany();
  await tx.customer.deleteMany();
  await tx.voucherSequence.deleteMany();
}

export const POST = withSuperAdmin(async (request: NextRequest, _ctx: unknown, user: JWTPayload) => {
  let body: { secret?: string; confirm?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const guard = adminCleanupGuard({ requestSecret: body.secret, confirm: body.confirm });
  if (guard) return guard;

  const wipeToken = crypto.randomUUID();
  console.warn(
    `[ADMIN_CLEANUP] token=${wipeToken} user=${user.userId} ip=${getClientIP(request)} ts=${new Date().toISOString()} ` +
    `STARTING full business-data wipe (ENABLE_ADMIN_CLEANUP=true, NODE_ENV=${process.env.NODE_ENV}).`,
  );

  try {
    await prisma.$transaction(async (tx) => {
      await wipeTestData(tx);
    });
    console.warn(`[ADMIN_CLEANUP] token=${wipeToken} user=${user.userId} COMPLETED successfully.`);
    return NextResponse.json({ success: true, message: "All test data deleted", wipeToken });
  } catch (error: unknown) {
    console.error(`[ADMIN_CLEANUP] token=${wipeToken} user=${user.userId} FAILED:`, error);
    return NextResponse.json(
      { error: clientErrorMessage(error, "Admin cleanup failed"), wipeToken, message: "The wipe was rolled back — no data was deleted. Check server logs for details." },
      { status: 500 },
    );
  }
});
