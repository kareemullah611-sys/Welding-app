import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";

const SECRET = "mrf-cleanup-2024-xk9";

export const POST = async (request: NextRequest) => {
  const { secret } = await request.json();
  if (secret !== SECRET) return Response.json({ error: "forbidden" }, { status: 403 });

  try {
    // Delete in FK-safe order: children before parents
    await prisma.profitAllocation.deleteMany();
    await prisma.investorWithdrawal.deleteMany();
    await prisma.investorDeposit.deleteMany();
    await prisma.investorAccount.deleteMany();
    await prisma.investor.deleteMany();
    await prisma.journalEntry.deleteMany();
    await prisma.auditLog.deleteMany();
    await prisma.notification.deleteMany();
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

    return Response.json({ success: true, message: "All test data deleted" });
  } catch (error: any) {
    return Response.json({ error: error?.message ?? "failed" }, { status: 500 });
  }
};
