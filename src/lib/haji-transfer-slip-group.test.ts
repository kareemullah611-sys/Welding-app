import test from "node:test";
import assert from "node:assert/strict";
import {
  groupHajiTransferSlipRows,
  getHajiTransferSlipDeleteIds,
  isGroupedHajiTransferSlip,
} from "@/lib/haji-transfer-slip-group";

const baseSlip = {
  recordType: "haji_transfer",
  cityId: 1,
  lotId: 10,
  transferDate: "2026-06-01",
  referenceNo: "REF-1",
  transferredTo: "Super Admin Account",
  detail: "mzn-4002 transfer",
  superAdminBankAccountId: 5,
  superAdminCashAccountId: null,
  currency: { id: 1, code: "PKR", symbol: "Rs" },
};

test("groupHajiTransferSlipRows merges cash and cheque parts of one slip", () => {
  const rows = groupHajiTransferSlipRows([
    { ...baseSlip, id: 101, sourceType: "cash_office", amount: 5000 },
    { ...baseSlip, id: 102, sourceType: "cheque", amount: 12000 },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceType, "mixed_cash_cheque");
  assert.equal(rows[0].amount, 17000);
  assert.deepEqual(rows[0].slipTransferIds, [101, 102]);
});

test("groupHajiTransferSlipRows merges multiple cheques on one slip", () => {
  const rows = groupHajiTransferSlipRows([
    { ...baseSlip, id: 201, sourceType: "cheque", amount: 3000 },
    { ...baseSlip, id: 202, sourceType: "cheque", amount: 7000 },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceType, "mixed_cash_cheque");
  assert.equal(rows[0].amount, 10000);
});

test("groupHajiTransferSlipRows leaves single rows unchanged", () => {
  const rows = groupHajiTransferSlipRows([
    { ...baseSlip, id: 301, sourceType: "cash_office", amount: 5000 },
    { ...baseSlip, id: 302, sourceType: "bank_transfer", amount: 8000, detail: "mzn-4002 online" },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].sourceType, "cash_office");
  assert.equal(rows[1].sourceType, "bank_transfer");
});

test("groupHajiTransferSlipRows does not merge rows with different currencies", () => {
  const rows = groupHajiTransferSlipRows([
    { ...baseSlip, id: 401, sourceType: "cash_office", amount: 5000, currency: { code: "PKR" } },
    {
      ...baseSlip,
      id: 402,
      sourceType: "cheque",
      amount: 12000,
      currency: { code: "USD" },
    },
  ]);

  assert.equal(rows.length, 2);
});

test("getHajiTransferSlipDeleteIds returns all slip ids", () => {
  const item = { id: 102, slipTransferIds: [101, 102] };
  assert.deepEqual(getHajiTransferSlipDeleteIds(item), [101, 102]);
  assert.equal(isGroupedHajiTransferSlip(item), true);
});
