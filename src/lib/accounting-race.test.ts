import assert from "node:assert/strict";
import test from "node:test";

import { getCashAccountId } from "@/lib/accounting";

test("system account lookup uses atomic upsert", async () => {
  let upsertArgs: unknown = null;
  const db = {
    city: {
      findUnique: async () => ({ name: "Quetta" }),
    },
    account: {
      upsert: async (args: unknown) => {
        upsertArgs = args;
        return { id: 42 };
      },
      findUnique: async () => {
        throw new Error("findUnique should not be used for get-or-create");
      },
      create: async () => {
        throw new Error("create should not be used for get-or-create");
      },
    },
  };

  const accountId = await getCashAccountId(1, db as any);

  assert.equal(accountId, 42);
  assert.deepEqual(upsertArgs, {
    where: { code: "1001-CITY1" },
    update: {},
    create: { code: "1001-CITY1", name: "Cash - Quetta", accountType: "asset", cityId: 1, isSystem: true },
  });
});
