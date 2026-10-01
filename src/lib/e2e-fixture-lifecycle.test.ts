import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("E2E teardown never deletes sessions or audit logs by a global time watermark", () => {
  const source = readFileSync("scripts/e2e-fixture-lifecycle.ts", "utf8");

  assert.doesNotMatch(source, /createdAt:\s*\{\s*gte:\s*since/);
  assert.doesNotMatch(source, /type Watermark = \{ startedAt: string \}/);
  assert.match(source, /sessionIds/);
  assert.match(source, /auditLogIds/);
});

test("E2E residue snapshot covers every table owned by the fixture lifecycle", () => {
  const lifecycle = readFileSync("scripts/e2e-fixture-lifecycle.ts", "utf8");
  const seed = readFileSync("scripts/e2e-hard-delete-seed.ts", "utf8");

  for (const model of ["godown", "product", "lotCityDistribution", "lotCityGodownAllocation", "syncRequest", "foreignCurrencyCarryingLayer", "foreignCurrencyMovement"]) {
    assert.match(lifecycle, new RegExp(`prisma\\.${model}\\.count\\(`), `${model} must be residue-checked`);
  }
  assert.match(seed, /E2E/);
});
