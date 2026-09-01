import { PrismaClient } from "@prisma/client";
import { resolveLegacyTransferTarget } from "../src/lib/superadmin-transfer-backfill";
import { requireApplyAcknowledgement } from "./database-target-safety";

const prisma = new PrismaClient();

async function main() {
  const safety = requireApplyAcknowledgement();
  const accounts = await prisma.superAdminBankAccount.findMany({
    select: { id: true, bankName: true, accountNumber: true, accountKind: true },
  });

  const unlinked = await prisma.hajiTransfer.findMany({
    where: {
      superAdminBankAccountId: null,
      superAdminCashAccountId: null,
    },
    select: { id: true, transferredTo: true, currencyId: true },
  });

  const planned: Array<{ transferId: number; bankId: number }> = [];
  let cashMatched = 0;
  let skipped = 0;

  for (const transfer of unlinked) {
    const target = resolveLegacyTransferTarget(transfer.transferredTo, accounts);
    if (!target) {
      skipped++;
      continue;
    }
    // Only backfill bank-kind links. Cash pots are already consistent: display
    // and validation both match legacy cash transfers by `transferredTo` label,
    // and the cash FK branch additionally requires settlementDestination
    // "super_admin_cash" (which legacy rows do not have). Linking them here
    // would drop their balance from the cash-pot calculation.
    if (target.bankId) {
      planned.push({ transferId: transfer.id, bankId: target.bankId });
    } else {
      cashMatched++;
    }
  }

  if (safety.apply) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('backfill-superadmin-transfer-links'))`;
      for (const item of planned) {
        await tx.hajiTransfer.updateMany({
          where: { id: item.transferId, superAdminBankAccountId: null, superAdminCashAccountId: null },
          data: { superAdminBankAccountId: item.bankId },
        });
      }
    });
  }

  console.log(JSON.stringify({
    mode: safety.apply ? "APPLIED" : "PREVIEW_ONLY",
    target: safety.target.label,
    scanned: unlinked.length,
    bankLinked: safety.apply ? planned.length : 0,
    bankLinksPlanned: planned.length,
    cashMatched,
    skipped,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
