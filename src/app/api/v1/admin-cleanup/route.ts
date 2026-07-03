import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";
import { clientErrorMessage } from "@/lib/client-error";

function adminCleanupGuard(requestSecret: string | null | undefined) {
  // Never available in production — use migrations / manual DBA for schema changes.
  if (process.env.NODE_ENV === "production") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const enabled = process.env.ENABLE_ADMIN_CLEANUP === "true";
  const secret = process.env.ADMIN_CLEANUP_SECRET;

  if (!enabled) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  if (!secret) {
    return Response.json({ error: "misconfigured" }, { status: 503 });
  }
  if (requestSecret !== secret) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

async function wipeTestData() {
  await prisma.profitAllocation.deleteMany();
  await prisma.investorWithdrawal.deleteMany();
  await prisma.investorDeposit.deleteMany();
  await prisma.investorAccount.deleteMany();
  await prisma.investor.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.saleItem.deleteMany();
  await prisma.saleDiscount.deleteMany();
  await prisma.paymentLotTransfer.deleteMany();
  await prisma.lotSettlementOverflow.deleteMany();
  await prisma.sale.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.godownTransfer.deleteMany();
  await prisma.cityTransfer.deleteMany();
  await prisma.lotCityGodownAllocation.deleteMany();
  await prisma.lotCityDistribution.deleteMany();
  await prisma.lotProduct.deleteMany();
  await prisma.lotCost.deleteMany();
  await prisma.lotPurchase.deleteMany();
  await prisma.supplierPayment.deleteMany();
  await prisma.shippingLinePayment.deleteMany();
  await prisma.agentPayment.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.hajiTransfer.deleteMany();
  await prisma.personalWithdrawal.deleteMany();
  await prisma.bankDeposit.deleteMany();
  await prisma.lot.deleteMany();
  await prisma.intermediaryDeposit.deleteMany();
  await prisma.intermediary.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.voucherSequence.deleteMany();
}

/** Dev-only destructive tools — secret must be in POST JSON body, never query strings. */
export const POST = withSuperAdmin(async (request: NextRequest, _ctx: unknown, _user: JWTPayload) => {
  let body: { secret?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const guard = adminCleanupGuard(body.secret);
  if (guard) return guard;

  try {
    await wipeTestData();
    return Response.json({ success: true, message: "All test data deleted" });
  } catch (error: unknown) {
    console.error("Admin cleanup error:", error);
    return Response.json(
      { error: clientErrorMessage(error, "Admin cleanup failed") },
      { status: 500 },
    );
  }
});
