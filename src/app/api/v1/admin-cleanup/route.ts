import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";

const SECRET = "mrf-cleanup-2024-xk9";

export const POST = async (request: NextRequest) => {
  const { secret } = await request.json();
  if (secret !== SECRET) return Response.json({ error: "forbidden" }, { status: 403 });

  try {
    await prisma.$transaction([
      prisma.profitAllocation.deleteMany(),
      prisma.investorWithdrawal.deleteMany(),
      prisma.investorDeposit.deleteMany(),
      prisma.investorAccount.deleteMany(),
      prisma.investor.deleteMany(),
      prisma.journalEntry.deleteMany(),
      prisma.auditLog.deleteMany(),
      prisma.notification.deleteMany(),
      prisma.attachment.deleteMany(),
      prisma.saleItem.deleteMany(),
      prisma.saleDiscount.deleteMany(),
      prisma.paymentLotTransfer.deleteMany(),
      prisma.lotSettlementOverflow.deleteMany(),
      prisma.sale.deleteMany(),
      prisma.payment.deleteMany(),
      prisma.godownTransfer.deleteMany(),
      prisma.cityTransfer.deleteMany(),
      prisma.lotCityGodownAllocation.deleteMany(),
      prisma.lotCityDistribution.deleteMany(),
      prisma.lotProduct.deleteMany(),
      prisma.lotCost.deleteMany(),
      prisma.lotPurchase.deleteMany(),
      prisma.supplierPayment.deleteMany(),
      prisma.shippingLinePayment.deleteMany(),
      prisma.agentPayment.deleteMany(),
      prisma.lot.deleteMany(),
      prisma.expense.deleteMany(),
      prisma.hajiTransfer.deleteMany(),
      prisma.personalWithdrawal.deleteMany(),
      prisma.bankDeposit.deleteMany(),
      prisma.customer.deleteMany(),
      prisma.voucherSequence.deleteMany(),
    ]);

    return Response.json({ success: true, message: "All test data deleted" });
  } catch (error: any) {
    return Response.json({ error: error?.message ?? "failed" }, { status: 500 });
  }
};
