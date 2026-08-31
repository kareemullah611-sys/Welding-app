import { PrismaClient } from "@prisma/client";

import { assertProductionDatabaseEnv, runMigrateDeployWithRetry } from "./migrate-deploy";

const prisma = new PrismaClient();

async function main() {
  console.log("Bootstrapping database with migration-only safety...");
  assertProductionDatabaseEnv();

  if (process.env.PRISMA_MIGRATE_AT_BUILD === "true") {
    console.log("Skipping migrate deploy on start (PRISMA_MIGRATE_AT_BUILD=true).");
  } else {
    await runMigrateDeployWithRetry({ stdio: "inherit" });
  }

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    throw new Error("Database contains no users. Bootstrap never seeds automatically; run the approved seed procedure explicitly.");
  }
  console.log(`Database migration state accepted with ${userCount} user(s).`);
}

main()
  .catch((error) => {
    console.error("Bootstrap failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
