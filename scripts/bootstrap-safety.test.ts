import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./bootstrap.ts", import.meta.url), "utf8");

test("bootstrap is migration-only and never repairs or baselines schema", () => {
  assert.doesNotMatch(source, /prisma db push/i);
  assert.doesNotMatch(source, /migrate resolve/i);
  assert.doesNotMatch(source, /\$executeRawUnsafe/);
  assert.doesNotMatch(source, /prisma\/seed\.ts/);
  assert.match(source, /runMigrateDeployWithRetry/);
});
