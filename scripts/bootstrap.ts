import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function run(cmd: string) {
  execSync(cmd, { stdio: "inherit" });
}

async function main() {
  console.log("Bootstrapping database...");
  const mode = (process.env.PRISMA_BOOTSTRAP_MODE || "").trim().toLowerCase();
  const isProduction = process.env.NODE_ENV === "production";

  // Safety default:
  // - production -> migrations only (avoids db push data-loss prompt halting startup)
  // - non-production -> db push convenience
  if (mode === "db_push") {
    run("npx prisma db push");
  } else if (mode === "migrate") {
    run("npx prisma migrate deploy");
  } else if (isProduction) {
    run("npx prisma migrate deploy");
  } else {
    run("npx prisma db push");
  }

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    console.log("No users found. Running initial seed...");
    run("npx tsx prisma/seed.ts");
  } else {
    console.log(`Database already initialized with ${userCount} user(s). Skipping seed.`);
  }
}

main()
  .catch((error) => {
    console.error("Bootstrap failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
