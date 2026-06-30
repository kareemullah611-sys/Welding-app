import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeValidationDetails } from "@/lib/sanitize-validation-details";

test("sanitizeValidationDetails redacts sensitive field issues", () => {
  const result = sanitizeValidationDetails([
    { code: "too_small", path: ["username"], message: "Required" },
    { code: "too_small", path: ["password"], message: "Too short", received: "secret123" },
    { code: "custom", path: ["currentPassword"], message: "Wrong", input: "x" },
  ]);

  assert.deepEqual(result?.[0], { code: "too_small", path: ["username"], message: "Required" });
  assert.deepEqual(result?.[1], { code: "too_small", path: ["password"], message: "Invalid value" });
  assert.deepEqual(result?.[2], { code: "custom", path: ["currentPassword"], message: "Invalid value" });
});
