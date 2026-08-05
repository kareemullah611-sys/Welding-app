import { PrismaClient } from "@prisma/client";
import { resolveLegacyTransferTarget } from "../src/lib/superadmin-transfer-backfill";

const prisma = new PrismaClient();

async function main() {
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

  let bankLinked = 0;
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
      await prisma.hajiTransfer.update({
        where: { id: transfer.id },
        data: { superAdminBankAccountId: target.bankId },
      });
      bankLinked++;
    } else {
      cashMatched++;
    }
  }

  console.log(
    JSON.stringify({ scanned: unlinked.length, bankLinked, cashMatched, skipped }, null, 2)
  );
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
