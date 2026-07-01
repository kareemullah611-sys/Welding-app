import assert from "node:assert/strict";
import test from "node:test";

import { isSeedGodownName, SEED_GODOWN_NAMES } from "@/lib/seed-godown-names";

test("recognizes bootstrap godown names", () => {
  assert.equal(isSeedGodownName("Quetta Main Warehouse"), true);
  assert.equal(isSeedGodownName("Wesh Border Godown"), true);
});

test("allows user-created godown names", () => {
  assert.equal(isSeedGodownName("North Side Store"), false);
  assert.equal(isSeedGodownName(""), false);
});

test("lists every seeded default godown", () => {
  assert.equal(SEED_GODOWN_NAMES.size, 7);
});
