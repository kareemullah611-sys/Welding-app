import assert from "node:assert/strict";
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
