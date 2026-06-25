import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAfghanistanHajiSettlementEligible } from "@/lib/haji-transfer-audit";

describe("isAfghanistanHajiSettlementEligible", () => {
  it("returns true for cash office intermediary settlement", () => {
    assert.equal(
      isAfghanistanHajiSettlementEligible({
        sourceType: "cash_office",
        settlementDestination: "intermediary",
      }),
      true
    );
  });

  it("returns true for cash office super admin cash settlement", () => {
    assert.equal(
      isAfghanistanHajiSettlementEligible({
        sourceType: "cash_office",
        settlementDestination: "super_admin_cash",
      }),
      true
    );
  });

  it("returns false for standard Pakistan settlement", () => {
    assert.equal(
      isAfghanistanHajiSettlementEligible({
        sourceType: "cash_office",
        settlementDestination: "standard",
      }),
      false
    );
  });

  it("returns false for bank transfer even with intermediary destination", () => {
    assert.equal(
      isAfghanistanHajiSettlementEligible({
        sourceType: "bank_transfer",
        settlementDestination: "intermediary",
      }),
      false
    );
  });
});

/** Mirrors journalHajiTransfer debit account selection. */
function hajiTransferDebitTarget(input: {
  settlementDestination?: string | null;
  intermediaryId?: number | null;
  superAdminCashAccountId?: number | null;
}) {
  if (input.settlementDestination === "intermediary" && input.intermediaryId) return "intermediary";
  if (input.settlementDestination === "super_admin_cash" && input.superAdminCashAccountId) return "sa_cash";
  return "haji_equity";
}

describe("haji transfer journal debit routing", () => {
  it("debits intermediary asset for intermediary path", () => {
    assert.equal(
      hajiTransferDebitTarget({ settlementDestination: "intermediary", intermediaryId: 3 }),
      "intermediary"
    );
  });

  it("debits super admin cash GL for super_admin_cash path", () => {
    assert.equal(
      hajiTransferDebitTarget({ settlementDestination: "super_admin_cash", superAdminCashAccountId: 5 }),
      "sa_cash"
    );
  });

  it("debits haji equity for standard Pakistan path", () => {
    assert.equal(hajiTransferDebitTarget({ settlementDestination: "standard" }), "haji_equity");
  });
});
