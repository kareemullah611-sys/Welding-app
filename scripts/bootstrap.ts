import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Bootstrapping database...");
  execSync("npx prisma db push", { stdio: "inherit" });

  const userCount = await prisma.user.count();
  if (userCount === 0) {
    console.log("No users found. Running initial seed...");
    execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });
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
