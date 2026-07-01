import { PrismaClient } from "@prisma/client";
import { purgeLegacyOpeningStockData } from "../src/lib/legacy-stock-lot";

const prisma = new PrismaClient();

async function main() {
  console.log("Purging OLD-STOCK legacy allocations and historical opening sales...");
  const result = await purgeLegacyOpeningStockData(prisma);
  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error("Purge failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
