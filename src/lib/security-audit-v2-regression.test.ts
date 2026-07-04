import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

test("JWT verification pins issuer audience and algorithm in node and edge runtimes", () => {
  const auth = readFileSync("src/lib/auth.ts", "utf8");
  const edge = readFileSync("src/lib/jwt-edge.ts", "utf8");

  assert.match(auth, /JWT_ISSUER/);
  assert.match(auth, /JWT_AUDIENCE/);
  assert.match(auth, /algorithms:\s*\["HS256"\]/);
  assert.match(edge, /MIN_JWT_SECRET_LENGTH/);
  assert.match(edge, /issuer:\s*JWT_ISSUER/);
  assert.match(edge, /audience:\s*JWT_AUDIENCE/);
});

test("middleware static bypass uses an extension allowlist instead of any dot in path", () => {
  const middleware = readFileSync("src/middleware.ts", "utf8");

  assert.match(middleware, /STATIC_FILE_EXTENSION_PATTERN/);
  assert.doesNotMatch(middleware, /pathname\.includes\("\."\)/);
});

test("v2 validation gaps are covered by Zod schemas", () => {
  const validations = readFileSync("src/lib/validations.ts", "utf8");
  const paymentRoute = readFileSync("src/app/api/v1/payments/[id]/route.ts", "utf8");
  const expenseRoute = readFileSync("src/app/api/v1/expenses/[id]/route.ts", "utf8");
  const godownPermissionsRoute = readFileSync("src/app/api/v1/godown-permissions/route.ts", "utf8");

  assert.match(validations, /updatePaymentSchema/);
  assert.match(validations, /updateExpenseSchema/);
  assert.match(validations, /godownPermissionSchema/);
  assert.match(paymentRoute, /updatePaymentSchema\.safeParse/);
  assert.match(expenseRoute, /updateExpenseSchema\.safeParse/);
  assert.match(godownPermissionsRoute, /godownPermissionSchema\.safeParse/);
});

test("Capacitor server URL rejects cleartext HTTP", () => {
  const config = readFileSync("capacitor.config.ts", "utf8");

  assert.match(config, /CAPACITOR_ALLOW_CLEARTEXT_HTTP/);
  assert.match(config, /throw new Error\("CAPACITOR_SERVER_URL must use HTTPS/);
  assert.doesNotMatch(config, /cleartext:\s*serverUrl\.startsWith\("http:\/\/"\)/);
});

test("tsx is not installed as a production dependency", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(pkg.dependencies?.tsx, undefined);
  assert.ok(pkg.devDependencies?.tsx);
});

test("bank account numbers are encrypted before persistence", async () => {
  const prisma = readFileSync("src/lib/prisma.ts", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260703000500_expand_encrypted_account_numbers/migration.sql", "utf8");

  assert.match(prisma, /encryptAccountNumberInData\(params\.args\.data\)/);
  assert.match(prisma, /decryptSensitiveFields\(result\)/);
  assert.match(schema, /model BankAccount[\s\S]*accountNumber\s+String\?\s+@map\("account_number"\)\s+@db\.VarChar\(255\)/);
  assert.match(schema, /model SuperAdminBankAccount[\s\S]*accountNumber\s+String\?\s+@map\("account_number"\)\s+@db\.VarChar\(255\)/);
  assert.match(migration, /ALTER TABLE "bank_accounts"[\s\S]*"account_number" TYPE VARCHAR\(255\)/);
  assert.match(migration, /ALTER TABLE "super_admin_bank_accounts"[\s\S]*"account_number" TYPE VARCHAR\(255\)/);

  process.env.DATA_ENCRYPTION_KEY = "test-data-encryption-key-with-32-bytes";
  const { decryptSensitiveText, encryptSensitiveText, isEncryptedSensitiveText } = await import("./sensitive-encryption");

  const encrypted = encryptSensitiveText("4002-1234");
  assert.notEqual(encrypted, "4002-1234");
  assert.equal(isEncryptedSensitiveText(encrypted), true);
  assert.equal(decryptSensitiveText(encrypted), "4002-1234");
});

test("audit enum findings are backed by Prisma database enums", () => {
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260703000400_enum_rls_foundation/migration.sql", "utf8");

  assert.match(schema, /enum AgentType\s*{[^}]*customs[^}]*transport[^}]*freight[^}]*other/s);
  assert.match(schema, /enum AgentPaymentMethod\s*{[^}]*cash[^}]*bank_transfer[^}]*online[^}]*cheque[^}]*intermediary[^}]*super_admin_cash/s);
  assert.match(schema, /enum CityTransferStatus\s*{[^}]*pending[^}]*approved[^}]*rejected/s);
  assert.match(schema, /agentType\s+AgentType\s+@map\("agent_type"\)/);
  assert.match(schema, /paymentMethod\s+AgentPaymentMethod\s+@map\("payment_method"\)/);
  assert.match(schema, /status\s+CityTransferStatus\s+@default\(pending\)/);

  assert.match(migration, /CREATE TYPE "AgentType"/);
  assert.match(migration, /ALTER TABLE "agents"\s+ALTER COLUMN "agent_type" TYPE "AgentType"/);
  assert.match(migration, /CREATE TYPE "AgentPaymentMethod"/);
  assert.match(migration, /ALTER TABLE "agent_payments"\s+ALTER COLUMN "payment_method" TYPE "AgentPaymentMethod"/);
  assert.match(migration, /CREATE TYPE "CityTransferStatus"/);
  assert.match(migration, /ALTER TABLE "city_transfers"[\s\S]*ALTER COLUMN "status" TYPE "CityTransferStatus"/);
});

test("RLS foundation is present but not forcibly enabled before request context is wired", () => {
  const migration = readFileSync("prisma/migrations/20260703000400_enum_rls_foundation/migration.sql", "utf8");

  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS app_security/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION app_security\.current_user_role\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION app_security\.current_city_id\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION app_security\.can_access_city\(row_city_id INTEGER\)/);
  assert.match(migration, /COMMENT ON FUNCTION app_security\.can_access_city/);
  assert.doesNotMatch(migration, /SELECT app_security\.enable_city_rls\(\)/);
});

test("Prisma RLS context is opt-in and transaction-scoped", () => {
  const middleware = readFileSync("src/lib/middleware.ts", "utf8");
  const prisma = readFileSync("src/lib/prisma.ts", "utf8");
  const context = readFileSync("src/lib/prisma-request-context.ts", "utf8");

  assert.match(middleware, /ENABLE_PRISMA_RLS_CONTEXT/);
  assert.match(middleware, /runWithPrismaRequestContext/);
  assert.match(prisma, /getCurrentPrismaTransaction/);
  assert.match(prisma, /prop === "\$transaction"/);
  assert.match(context, /AsyncLocalStorage/);
  assert.match(context, /set_config\('app.current_user_role'/);
  assert.match(context, /set_config\('app.current_city_id'/);
});

test("RLS migration defines dormant city isolation policies for core city tables", () => {
  const migration = readFileSync("prisma/migrations/20260703000400_enum_rls_foundation/migration.sql", "utf8");

  for (const table of ["customers", "payments", "expenses", "sales", "godowns", "bank_accounts", "bank_deposits"]) {
    assert.match(migration, new RegExp(`'${table}'`));
  }

  assert.match(migration, /CREATE POLICY city_isolation ON %I FOR ALL/);
  assert.match(migration, /app_security\.can_access_city\(city_id\)/);
  assert.match(migration, /CREATE POLICY city_transfer_isolation ON "city_transfers"/);
  assert.match(migration, /app_security\.can_access_city\(from_city_id\)/);
  assert.match(migration, /app_security\.can_access_city\(to_city_id\)/);
  assert.match(migration, /CREATE POLICY nullable_city_isolation ON %I FOR ALL/);
  assert.doesNotMatch(migration, /SELECT app_security\.enable_city_rls\(\)/);
});

test("RLS activation is explicit reversible and uses force when enabled", () => {
  const migration = readFileSync("prisma/migrations/20260703000400_enum_rls_foundation/migration.sql", "utf8");

  assert.match(migration, /CREATE OR REPLACE FUNCTION app_security\.enable_city_rls\(\)/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION app_security\.disable_city_rls\(\)/);
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = pg_catalog, public, app_security/);
  assert.match(migration, /ALTER TABLE %I ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE %I FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE %I NO FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /ALTER TABLE %I DISABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /SELECT app_security\.enable_city_rls\(\)/);
});

test("RLS activation has a read-only status check", () => {
  const migration = readFileSync("prisma/migrations/20260703000400_enum_rls_foundation/migration.sql", "utf8");

  assert.match(migration, /CREATE OR REPLACE FUNCTION app_security\.city_rls_status\(\)/);
  assert.match(migration, /RETURNS TABLE/);
  assert.match(migration, /table_name TEXT/);
  assert.match(migration, /rls_enabled BOOLEAN/);
  assert.match(migration, /rls_forced BOOLEAN/);
  assert.match(migration, /policy_count BIGINT/);
});

test("RLS operator actions are guarded by an explicit admin script", () => {
  assert.equal(existsSync("scripts/rls-admin.ts"), true);

  const script = readFileSync("scripts/rls-admin.ts", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  assert.match(script, /CONFIRM_ENABLE_CITY_RLS/);
  assert.match(script, /ENABLE_PRISMA_RLS_CONTEXT/);
  assert.match(script, /CONFIRM_DISABLE_CITY_RLS/);
  assert.match(script, /app_security\.city_rls_status\(\)/);
  assert.match(script, /app_security\.enable_city_rls\(\)/);
  assert.match(script, /app_security\.disable_city_rls\(\)/);
  assert.match(script, /process\.argv\.includes\("--enable"\)/);
  assert.match(script, /process\.argv\.includes\("--disable"\)/);
  assert.match(script, /process\.argv\.includes\("--status"\)/);

  assert.equal(pkg.scripts["rls:status"], "node --import tsx scripts/rls-admin.ts --status");
  assert.equal(pkg.scripts["rls:enable"], "node --import tsx scripts/rls-admin.ts --enable");
  assert.equal(pkg.scripts["rls:disable"], "node --import tsx scripts/rls-admin.ts --disable");
});

test("deployment pipeline audits production dependencies", () => {
  const render = readFileSync("render.yaml", "utf8");
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));

  assert.match(render, /npm run audit:prod:report/);
  assert.ok(pkg.scripts["audit:prod"]);
  assert.match(pkg.scripts["audit:prod"], /npm audit --omit=dev --audit-level=high/);
  assert.ok(pkg.scripts["audit:prod:report"]);
  assert.match(pkg.scripts["audit:prod:report"], /npm audit --omit=dev --audit-level=high \|\| echo/);
});
