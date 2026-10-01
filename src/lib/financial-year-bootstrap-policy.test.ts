import assert from "node:assert/strict";
import test from "node:test";

import { assertAccountingDateOpen } from "@/lib/accounting";

function fakeDb(input: { configured: number; matching?: { id: number } | null; closed?: { name: string } | null }) {
  let findCall = 0;
  return {
    financialYear: {
      count: async () => input.configured,
      findFirst: async () => {
        findCall += 1;
        return findCall === 1 ? (input.matching ?? null) : (input.closed ?? null);
      },
    },
    $executeRawUnsafe: async () => 0,
  } as any;
}

test("financial-year bootstrap allows posting only while no years exist", async () => {
  await assert.doesNotReject(assertAccountingDateOpen(new Date("2026-01-01"), fakeDb({ configured: 0 })));
  await assert.rejects(
    assertAccountingDateOpen(new Date("2026-01-01"), fakeDb({ configured: 1 })),
    /outside every configured financial year/,
  );
});

test("configured open periods allow posting and closed periods reject it", async () => {
  await assert.doesNotReject(assertAccountingDateOpen(new Date("2026-01-01"), fakeDb({ configured: 1, matching: { id: 7 } })));
  await assert.rejects(
    assertAccountingDateOpen(new Date("2026-01-01"), fakeDb({ configured: 1, matching: { id: 7 }, closed: { name: "FY 2026" } })),
    /Accounting period FY 2026 is closed/,
  );
});
