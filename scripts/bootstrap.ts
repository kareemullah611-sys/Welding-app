import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function run(cmd: string) {
  execSync(cmd, { stdio: "inherit" });
}

function runCapture(cmd: string) {
  execSync(cmd, { stdio: "pipe" });
}

function listMigrationDirectories(): string[] {
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  const entries = readdirSync(migrationsDir);
  return entries
    .filter((name) => name !== "migration_lock.toml")
    .filter((name) => statSync(path.join(migrationsDir, name)).isDirectory())
    .sort();
}

function errorToText(error: unknown): string {
  const e = error as any;
  const stderr = Buffer.isBuffer(e?.stderr) ? e.stderr.toString("utf8") : String(e?.stderr || "");
  const stdout = Buffer.isBuffer(e?.stdout) ? e.stdout.toString("utf8") : String(e?.stdout || "");
  return `${e?.message || ""}\n${stderr}\n${stdout}`;
}

function isPrismaP3005(error: unknown): boolean {
  const text = errorToText(error);
  return /P3005/i.test(text) || /schema is not empty/i.test(text);
}

function isAlreadyAppliedMigration(error: unknown): boolean {
  const text = errorToText(error);
  return /P3008/i.test(text) || /already recorded as applied/i.test(text);
}

function deployMigrationsWithBaselineFallback() {
  try {
    runCapture("npx prisma migrate deploy");
    return;
  } catch (error) {
    if (!isPrismaP3005(error)) throw error;
  }

  const migrations = listMigrationDirectories();
  if (!migrations.length) {
    throw new Error("Cannot baseline existing database: no local migrations found.");
  }

  console.log("Detected non-empty database without baseline (P3005). Marking migrations as applied...");
  for (const migration of migrations) {
    try {
      runCapture(`npx prisma migrate resolve --applied ${migration}`);
    } catch (error) {
      if (!isAlreadyAppliedMigration(error)) throw error;
    }
  }
  run("npx prisma migrate deploy");
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
    deployMigrationsWithBaselineFallback();
  } else if (isProduction) {
    deployMigrationsWithBaselineFallback();
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
