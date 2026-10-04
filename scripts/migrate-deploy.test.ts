import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import test from "node:test";

import { isPrismaP1002 } from "./migrate-deploy";

test("isPrismaP1002 detects advisory lock timeout", () => {
  const error = {
    message: "Command failed",
    stderr: "Error: P1002\nTimed out trying to acquire a postgres advisory lock",
  };
  assert.equal(isPrismaP1002(error), true);
});

test("isPrismaP1002 ignores unrelated errors", () => {
  assert.equal(isPrismaP1002({ message: "P3005 schema is not empty" }), false);
});

test("migration history has a fresh-database baseline and non-destructive compatibility migration", () => {
  const migrations = readdirSync("prisma/migrations")
    .filter((entry) => statSync(`prisma/migrations/${entry}`).isDirectory())
    .sort();
  assert.deepEqual(migrations, [
    "00000000000000_current_schema_baseline",
    "20261002130000_existing_database_compatibility",
  ]);

  const baseline = readFileSync("prisma/migrations/00000000000000_current_schema_baseline/migration.sql", "utf8");
  assert.match(baseline, /to_regclass\('public\.users'\) IS NULL/);
  for (const table of ["users", "cities", "customers", "products", "lots", "sales", "payments", "expenses", "journal_entries"]) {
    assert.match(baseline, new RegExp(`CREATE TABLE "${table}"`));
  }

  const compatibility = readFileSync("prisma/migrations/20261002130000_existing_database_compatibility/migration.sql", "utf8");
  assert.match(compatibility, /OPENING_CHEQUE_CUSTOMER_REMEDIATION_REQUIRED/);
  assert.match(compatibility, /SETTLEMENT_FX_SNAPSHOT_CONFLICT/);
  assert.doesNotMatch(compatibility, /DROP TABLE|DROP COLUMN/);
});

test("CI provisions every PostgreSQL job through migration deploy", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
  assert.doesNotMatch(workflow, /prisma db push/);
  assert.equal((workflow.match(/npx prisma migrate deploy/g) || []).length, 2);
});
