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

  // Safety guard: baseline fallback can mark migrations applied without executing SQL.
  // Enforce critical anti-duplicate cheque index directly.
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "payments_active_cheque_city_unique"
      ON "payments" ("city_id", "cheque_number")
      WHERE "status" = 'active'
        AND "payment_method" = 'cheque'
        AND "cheque_number" IS NOT NULL
  `);

  // Compatibility guard: some production DBs were baselined without this column.
  // Treasury reads supplier payments by bank account, so ensure schema parity.
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "supplier_payments"
      ADD COLUMN IF NOT EXISTS "bank_account_id" INTEGER
  `);
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'supplier_payments_bank_account_id_fkey'
      ) THEN
        ALTER TABLE "supplier_payments"
          ADD CONSTRAINT "supplier_payments_bank_account_id_fkey"
          FOREIGN KEY ("bank_account_id")
          REFERENCES "bank_accounts"("id")
          ON DELETE SET NULL
          ON UPDATE CASCADE;
      END IF;
    END $$;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "supplier_payments_bank_account_id_idx"
      ON "supplier_payments" ("bank_account_id")
  `);

  // Compatibility guard (extended): baseline-fallback DBs can lack columns that
  // the treasury / bank-account ledger / intermediary / super-admin reports query
  // by relation. Missing any of these makes those endpoints 500. All wrapped in a
  // single DO block (one statement) so it is safe for $executeRawUnsafe and idempotent.
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      ALTER TABLE "agent_payments"    ADD COLUMN IF NOT EXISTS "bank_account_id" INTEGER;
      ALTER TABLE "agent_payments"    ADD COLUMN IF NOT EXISTS "intermediary_id" INTEGER;
      ALTER TABLE "expenses"          ADD COLUMN IF NOT EXISTS "cheque_payment_id" INTEGER;
      ALTER TABLE "lot_costs"         ADD COLUMN IF NOT EXISTS "bank_account_id" INTEGER;
      ALTER TABLE "lot_costs"         ADD COLUMN IF NOT EXISTS "intermediary_id" INTEGER;
      ALTER TABLE "lot_costs"         ADD COLUMN IF NOT EXISTS "shipping_line_id" INTEGER;
      ALTER TABLE "lot_costs"         ADD COLUMN IF NOT EXISTS "super_admin_bank_account_id" INTEGER;
      ALTER TABLE "lot_costs"         ADD COLUMN IF NOT EXISTS "supplier_id" INTEGER;
      ALTER TABLE "supplier_payments" ADD COLUMN IF NOT EXISTS "intermediary_id" INTEGER;

      CREATE INDEX IF NOT EXISTS "agent_payments_bank_account_id_idx" ON "agent_payments" ("bank_account_id");
      CREATE INDEX IF NOT EXISTS "agent_payments_intermediary_id_idx" ON "agent_payments" ("intermediary_id");
      CREATE INDEX IF NOT EXISTS "lot_costs_supplier_id_idx" ON "lot_costs" ("supplier_id");
      CREATE INDEX IF NOT EXISTS "lot_costs_bank_account_id_idx" ON "lot_costs" ("bank_account_id");
      CREATE INDEX IF NOT EXISTS "lot_costs_super_admin_bank_account_id_idx" ON "lot_costs" ("super_admin_bank_account_id");
      CREATE INDEX IF NOT EXISTS "lot_costs_intermediary_id_idx" ON "lot_costs" ("intermediary_id");
      CREATE INDEX IF NOT EXISTS "supplier_payments_intermediary_id_idx" ON "supplier_payments" ("intermediary_id");

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_cheque_payment_id_fkey') THEN
        ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cheque_payment_id_fkey"
          FOREIGN KEY ("cheque_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_payments_bank_account_id_fkey') THEN
        ALTER TABLE "agent_payments" ADD CONSTRAINT "agent_payments_bank_account_id_fkey"
          FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_payments_intermediary_id_fkey') THEN
        ALTER TABLE "agent_payments" ADD CONSTRAINT "agent_payments_intermediary_id_fkey"
          FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_costs_supplier_id_fkey') THEN
        ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_supplier_id_fkey"
          FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_costs_shipping_line_id_fkey') THEN
        ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_shipping_line_id_fkey"
          FOREIGN KEY ("shipping_line_id") REFERENCES "shipping_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_costs_bank_account_id_fkey') THEN
        ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_bank_account_id_fkey"
          FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_costs_super_admin_bank_account_id_fkey') THEN
        ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_super_admin_bank_account_id_fkey"
          FOREIGN KEY ("super_admin_bank_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lot_costs_intermediary_id_fkey') THEN
        ALTER TABLE "lot_costs" ADD CONSTRAINT "lot_costs_intermediary_id_fkey"
          FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_payments_intermediary_id_fkey') THEN
        ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_intermediary_id_fkey"
          FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO "currencies" ("code", "name", "symbol")
    SELECT 'CNY', 'Chinese Yuan', '¥'
    WHERE NOT EXISTS (SELECT 1 FROM "currencies" WHERE "code" = 'CNY')
  `);

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
