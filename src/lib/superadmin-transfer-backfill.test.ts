import assert from "node:assert/strict";
import test from "node:test";

import { resolveLegacyTransferTarget } from "@/lib/superadmin-transfer-backfill";

const accounts = [
  { id: 5, bankName: "Meezan", accountNumber: "4002", accountKind: "bank" },
  { id: 6, bankName: "Faysal", accountNumber: "0127", accountKind: "bank" },
  { id: 7, bankName: "UBL", accountNumber: "3450", accountKind: "bank" },
  { id: 3, bankName: "Haji own", accountNumber: null, accountKind: "cash" },
];

test("matches bank by formatted label", () => {
  assert.deepEqual(resolveLegacyTransferTarget("UBL (3450)", accounts), { bankId: 7 });
  assert.deepEqual(resolveLegacyTransferTarget("Meezan (4002)", accounts), { bankId: 5 });
});

test("matches cash pot by label", () => {
  assert.deepEqual(resolveLegacyTransferTarget("Haji own", accounts), { cashId: 3 });
});

test("returns null for ambiguous label (two accounts same label)", () => {
  const ambiguous = [
    { id: 1, bankName: "HBL", accountNumber: "0042", accountKind: "bank" },
    { id: 2, bankName: "HBL", accountNumber: "0042", accountKind: "bank" },
  ];
  assert.equal(resolveLegacyTransferTarget("HBL (0042)", ambiguous), null);
});

test("returns null for unmatched or empty label", () => {
  assert.equal(resolveLegacyTransferTarget("No Such Bank (0000)", accounts), null);
  assert.equal(resolveLegacyTransferTarget("", accounts), null);
  assert.equal(resolveLegacyTransferTarget(null, accounts), null);
});
