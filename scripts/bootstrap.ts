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
  const isProduction =
    process.env.NODE_ENV === "production" || process.env.RENDER === "true";

  // Safety default:
  // - production / Render -> migrations only (avoids db push + generate OOM on small instances)
  // - non-production -> db push convenience (skip generate — client already built in CI)
  if (mode === "db_push") {
    run("npx prisma db push --skip-generate");
  } else if (mode === "migrate") {
    deployMigrationsWithBaselineFallback();
  } else if (isProduction) {
    deployMigrationsWithBaselineFallback();
  } else {
    run("npx prisma db push --skip-generate");
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

  await prisma.$executeRawUnsafe(`
    ALTER TABLE "lots" ADD COLUMN IF NOT EXISTS "is_legacy_stock" BOOLEAN NOT NULL DEFAULT false
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "lots_is_legacy_stock_idx" ON "lots"("is_legacy_stock")
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "is_opening_import" BOOLEAN NOT NULL DEFAULT false
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "sales_is_opening_import_idx" ON "sales"("is_opening_import")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "opening_haji_balances" (
      "id" SERIAL NOT NULL,
      "city_id" INTEGER NOT NULL,
      "currency_id" INTEGER NOT NULL,
      "amount" DECIMAL(15,2) NOT NULL,
      "opening_date" DATE NOT NULL,
      "notes" TEXT,
      "created_by" INTEGER NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "opening_haji_balances_pkey" PRIMARY KEY ("id")
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "unique_opening_haji_city_currency"
      ON "opening_haji_balances"("city_id", "currency_id")
  `);

  // Afghanistan Haji settlement + SA treasury cash accounts (baselined DBs may lack these).
  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SuperAdminAccountKind') THEN
        CREATE TYPE "SuperAdminAccountKind" AS ENUM ('bank', 'cash');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'HajiSettlementDestination') THEN
        CREATE TYPE "HajiSettlementDestination" AS ENUM ('standard', 'intermediary', 'super_admin_cash');
      END IF;

      ALTER TABLE "super_admin_bank_accounts"
        ADD COLUMN IF NOT EXISTS "account_kind" "SuperAdminAccountKind" NOT NULL DEFAULT 'bank';

      ALTER TABLE "haji_transfers"
        ADD COLUMN IF NOT EXISTS "settlement_destination" "HajiSettlementDestination" NOT NULL DEFAULT 'standard';
      ALTER TABLE "haji_transfers" ADD COLUMN IF NOT EXISTS "intermediary_id" INTEGER;
      ALTER TABLE "haji_transfers" ADD COLUMN IF NOT EXISTS "super_admin_cash_account_id" INTEGER;

      CREATE INDEX IF NOT EXISTS "haji_transfers_intermediary_id_idx" ON "haji_transfers" ("intermediary_id");
      CREATE INDEX IF NOT EXISTS "haji_transfers_super_admin_cash_account_id_idx" ON "haji_transfers" ("super_admin_cash_account_id");

      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'haji_transfers_intermediary_id_fkey') THEN
        ALTER TABLE "haji_transfers" ADD CONSTRAINT "haji_transfers_intermediary_id_fkey"
          FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'haji_transfers_super_admin_cash_account_id_fkey') THEN
        ALTER TABLE "haji_transfers" ADD CONSTRAINT "haji_transfers_super_admin_cash_account_id_fkey"
          FOREIGN KEY ("super_admin_cash_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'IntermediarySourceType' AND e.enumlabel = 'super_admin_cash'
      ) THEN
        ALTER TYPE "IntermediarySourceType" ADD VALUE 'super_admin_cash';
      END IF;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "haji_cash_receipts" (
      "id" SERIAL NOT NULL,
      "super_admin_cash_account_id" INTEGER NOT NULL,
      "intermediary_id" INTEGER NOT NULL,
      "receipt_date" DATE NOT NULL,
      "amount" DECIMAL(15,2) NOT NULL,
      "currency_id" INTEGER NOT NULL,
      "notes" TEXT,
      "created_by" INTEGER NOT NULL,
      "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "haji_cash_receipts_pkey" PRIMARY KEY ("id")
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "haji_cash_receipts_super_admin_cash_account_id_idx"
      ON "haji_cash_receipts"("super_admin_cash_account_id")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "haji_cash_receipts_intermediary_id_idx"
      ON "haji_cash_receipts"("intermediary_id")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "haji_cash_receipts_receipt_date_idx"
      ON "haji_cash_receipts"("receipt_date")
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "supplier_payments"
      ADD COLUMN IF NOT EXISTS "super_admin_cash_account_id" INTEGER
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "agent_payments"
      ADD COLUMN IF NOT EXISTS "super_admin_cash_account_id" INTEGER
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "shipping_line_payments"
      ADD COLUMN IF NOT EXISTS "super_admin_cash_account_id" INTEGER
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "intermediary_deposits"
      ADD COLUMN IF NOT EXISTS "super_admin_cash_account_id" INTEGER
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "supplier_payments_super_admin_cash_account_id_idx"
      ON "supplier_payments"("super_admin_cash_account_id")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "agent_payments_super_admin_cash_account_id_idx"
      ON "agent_payments"("super_admin_cash_account_id")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "shipping_line_payments_super_admin_cash_account_id_idx"
      ON "shipping_line_payments"("super_admin_cash_account_id")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "intermediary_deposits_super_admin_cash_account_id_idx"
      ON "intermediary_deposits"("super_admin_cash_account_id")
  `);

  await prisma.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'haji_cash_receipts_super_admin_cash_account_id_fkey') THEN
        ALTER TABLE "haji_cash_receipts" ADD CONSTRAINT "haji_cash_receipts_super_admin_cash_account_id_fkey"
          FOREIGN KEY ("super_admin_cash_account_id") REFERENCES "super_admin_bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'haji_cash_receipts_intermediary_id_fkey') THEN
        ALTER TABLE "haji_cash_receipts" ADD CONSTRAINT "haji_cash_receipts_intermediary_id_fkey"
          FOREIGN KEY ("intermediary_id") REFERENCES "intermediaries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'haji_cash_receipts_currency_id_fkey') THEN
        ALTER TABLE "haji_cash_receipts" ADD CONSTRAINT "haji_cash_receipts_currency_id_fkey"
          FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'haji_cash_receipts_created_by_fkey') THEN
        ALTER TABLE "haji_cash_receipts" ADD CONSTRAINT "haji_cash_receipts_created_by_fkey"
          FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END $$;
  `);

  const bootstrapUser = await prisma.user.findFirst({
    where: { role: "super_admin" },
    select: { id: true },
  });
  if (bootstrapUser) {
    const { ensureLegacyLotsForAllCountries, migrateOpeningStocksToLegacyLots } = await import(
      "../src/lib/legacy-stock-lot"
    );
    await ensureLegacyLotsForAllCountries(bootstrapUser.id);
    const migrated = await migrateOpeningStocksToLegacyLots(bootstrapUser.id);
    if (migrated > 0) {
      console.log(`Migrated ${migrated} opening stock row(s) to OLD-STOCK legacy lots`);
    }
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
