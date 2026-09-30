import assert from "node:assert/strict";
import test from "node:test";

import { createAuditLog } from "@/lib/middleware";

test("L1: createAuditLog propagates audit insert failures instead of swallowing them", async () => {
  const brokenDb = {
    auditLog: {
      create: async () => {
        throw new Error("audit insert failed");
      },
    },
  } as any;

  await assert.rejects(
    () => createAuditLog(1, null, "payments", 1, "create", undefined, undefined, undefined, brokenDb),
    /audit insert failed/,
    "audit insert failure must propagate to the caller so the financial write rolls back"
  );
});
