import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";

function adminCleanupGuard(requestSecret: string | null | undefined) {
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

// Run once after deploy to create new tables
export const GET = withSuperAdmin(async (request: NextRequest, _ctx: any, _user: JWTPayload) => {
  const secret = request.nextUrl.searchParams.get("secret");
  const guard = adminCleanupGuard(secret);
  if (guard) return guard;

  try {
    await prisma.$executeRawUnsafe(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'IntermediarySourceType') THEN
          CREATE TYPE "IntermediarySourceType" AS ENUM ('city_cash', 'bank_account');
        END IF;
      END $$;
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "intermediaries" (
        "id" SERIAL PRIMARY KEY,
        "name" VARCHAR(200) NOT NULL,
        "notes" TEXT,
        "is_active" BOOLEAN NOT NULL DEFAULT true,
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "intermediary_deposits" (
        "id" SERIAL PRIMARY KEY,
        "intermediary_id" INTEGER NOT NULL REFERENCES "intermediaries"("id"),
        "deposit_date" DATE NOT NULL,
        "amount" DECIMAL(15,2) NOT NULL,
        "currency_id" INTEGER NOT NULL REFERENCES "currencies"("id"),
        "source_type" "IntermediarySourceType" NOT NULL,
        "city_id" INTEGER REFERENCES "cities"("id"),
        "bank_account_id" INTEGER REFERENCES "bank_accounts"("id"),
        "notes" TEXT,
        "created_by" INTEGER NOT NULL REFERENCES "users"("id"),
        "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "intermediary_deposits_intermediary_id_idx" ON "intermediary_deposits"("intermediary_id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "intermediary_deposits_deposit_date_idx" ON "intermediary_deposits"("deposit_date")`);

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "supplier_payments"
        ADD COLUMN IF NOT EXISTS "intermediary_id" INTEGER REFERENCES "intermediaries"("id");
    `);

    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "supplier_payments_intermediary_id_idx" ON "supplier_payments"("intermediary_id")`);

    // ShippingLinePayment: add bankAccountId and intermediaryId
    await prisma.$executeRawUnsafe(`ALTER TABLE "shipping_line_payments" ADD COLUMN IF NOT EXISTS "bank_account_id" INTEGER REFERENCES "bank_accounts"("id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "shipping_line_payments_bank_account_id_idx" ON "shipping_line_payments"("bank_account_id")`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "shipping_line_payments" ADD COLUMN IF NOT EXISTS "intermediary_id" INTEGER REFERENCES "intermediaries"("id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "shipping_line_payments_intermediary_id_idx" ON "shipping_line_payments"("intermediary_id")`);

    // AgentPayment: add bankAccountId and intermediaryId
    await prisma.$executeRawUnsafe(`ALTER TABLE "agent_payments" ADD COLUMN IF NOT EXISTS "bank_account_id" INTEGER REFERENCES "bank_accounts"("id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agent_payments_bank_account_id_idx" ON "agent_payments"("bank_account_id")`);
    await prisma.$executeRawUnsafe(`ALTER TABLE "agent_payments" ADD COLUMN IF NOT EXISTS "intermediary_id" INTEGER REFERENCES "intermediaries"("id")`);
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "agent_payments_intermediary_id_idx" ON "agent_payments"("intermediary_id")`);

    return Response.json({ success: true, message: "Migration complete" });
  } catch (error: any) {
    return Response.json({ error: error?.message ?? "failed" }, { status: 500 });
  }
});

export const POST = withSuperAdmin(async (request: NextRequest, _ctx: any, _user: JWTPayload) => {
  const { secret } = await request.json();
  const guard = adminCleanupGuard(secret);
  if (guard) return guard;

  try {
    // Delete in FK-safe order: children before parents
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

    return Response.json({ success: true, message: "All test data deleted" });
  } catch (error: any) {
    return Response.json({ error: error?.message ?? "failed" }, { status: 500 });
  }
});
