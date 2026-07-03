import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");

function modelBlock(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `model ${name} should exist`);
  return match[1];
}

test("SyncRequest has database-backed city and creator relations", () => {
  const city = modelBlock("City");
  const user = modelBlock("User");
  const syncRequest = modelBlock("SyncRequest");

  assert.match(city, /syncRequests\s+SyncRequest\[\]/);
  assert.match(user, /syncRequestsCreated\s+SyncRequest\[\]\s+@relation\("SyncRequestCreatedBy"\)/);
  assert.match(syncRequest, /city\s+City\s+@relation\(fields: \[cityId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(syncRequest, /creator\s+User\?\s+@relation\("SyncRequestCreatedBy", fields: \[createdBy\], references: \[id\], onDelete: SetNull\)/);
});

test("OpeningLiability uses type-scoped uniqueness and party check constraints", () => {
  const openingLiability = modelBlock("OpeningLiability");

  assert.doesNotMatch(openingLiability, /@@unique\(\[(supplierId|shippingLineId|agentId|intermediaryId), currencyId\]/);
  assert.match(openingLiability, /@@index\(\[supplierId, currencyId\]/);
  assert.match(openingLiability, /@@index\(\[shippingLineId, currencyId\]/);
  assert.match(openingLiability, /@@index\(\[agentId, currencyId\]/);
  assert.match(openingLiability, /@@index\(\[intermediaryId, currencyId\]/);

  const migration = readFileSync("prisma/migrations/20260703000100_audit_data_integrity/migration.sql", "utf8");
  assert.match(migration, /opening_liabilities_party_type_check/);
  assert.match(migration, /WHERE "liability_type" = 'supplier' AND "supplier_id" IS NOT NULL/);
  assert.match(migration, /WHERE "liability_type" = 'shipping_line' AND "shipping_line_id" IS NOT NULL/);
  assert.match(migration, /WHERE "liability_type" = 'agent' AND "agent_id" IS NOT NULL/);
  assert.match(migration, /WHERE "liability_type" = 'intermediary' AND "intermediary_id" IS NOT NULL/);
});

test("core payable party names are unique in the database schema", () => {
  for (const name of ["Supplier", "ShippingLine", "Intermediary"]) {
    assert.match(modelBlock(name), /name\s+String\s+@unique\s+@db\.VarChar\(200\)/);
  }

  const migration = readFileSync("prisma/migrations/20260703000200_unique_party_names/migration.sql", "utf8");
  assert.match(migration, /ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_name_key" UNIQUE \("name"\)/);
  assert.match(migration, /ALTER TABLE "shipping_lines" ADD CONSTRAINT "shipping_lines_name_key" UNIQUE \("name"\)/);
  assert.match(migration, /ALTER TABLE "intermediaries" ADD CONSTRAINT "intermediaries_name_key" UNIQUE \("name"\)/);
});

test("opening balance records use restrict deletes instead of cascade deletes", () => {
  const models = [
    "OpeningCash",
    "OpeningHajiBalance",
    "OpeningCustomerBalance",
    "OpeningStock",
    "OpeningBankBalance",
    "OpeningCheque",
    "OpeningLiability",
  ];

  for (const name of models) {
    const block = modelBlock(name);
    assert.doesNotMatch(block, /onDelete: Cascade/);
  }

  const migration = readFileSync("prisma/migrations/20260703000300_restrict_opening_balance_deletes/migration.sql", "utf8");
  assert.match(migration, /ON DELETE RESTRICT ON UPDATE CASCADE/);
  assert.doesNotMatch(migration, /ON DELETE CASCADE/);
});
