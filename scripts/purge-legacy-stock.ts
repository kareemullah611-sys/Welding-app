import { PrismaClient } from "@prisma/client";
import { purgeLegacyOpeningStockData } from "../src/lib/legacy-stock-lot";
import { requireApplyAcknowledgement } from "./database-target-safety";

const prisma = new PrismaClient();

async function main() {
  const safety = requireApplyAcknowledgement();
  const [historicalSales, openingStocks, legacyLots] = await Promise.all([
    prisma.sale.count({ where: { isOpeningImport: true } }),
    prisma.openingStock.count(),
    prisma.lot.count({ where: { isLegacyStock: true } }),
  ]);
  if (!safety.apply) {
    console.log(JSON.stringify({ mode: "PREVIEW_ONLY", target: safety.target.label, historicalSales, openingStocks, legacyLots }, null, 2));
    return;
  }
  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('purge-legacy-opening-stock'))`;
    return purgeLegacyOpeningStockData(tx);
  });
  console.log(JSON.stringify({ mode: "APPLIED", target: safety.target.label, ...result }, null, 2));
}

main()
  .catch((error) => {
    console.error("Purge failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
