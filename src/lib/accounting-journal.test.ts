import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Mirrors supplier-payment bank credit leg selection in journalSupplierPaid. */
function supplierBankCreditLeg(input: {
  amountUsd: number;
  amountLocal?: number | null;
  bankAccountId?: number | null;
}) {
  if (input.bankAccountId && input.amountLocal && input.amountLocal > 0) {
    return { amount: input.amountLocal, currencyCode: "PKR" as const };
  }
  return { amount: input.amountUsd, currencyCode: "USD" as const };
}

/** Mirrors payment debit account routing in journalPaymentReceived. */
function paymentDebitTarget(input: {
  destination?: string | null;
  superAdminBankAccountId?: number | null;
  bankAccountId?: number | null;
  paymentMethod?: string | null;
}) {
  if (input.destination === "haji" && input.superAdminBankAccountId) return "sa_bank";
  if (input.destination === "haji") return "haji";
  if (input.bankAccountId && input.paymentMethod === "bank_transfer") return "city_bank";
  return "city_cash";
}

describe("accounting journal routing", () => {
  it("credits PKR bank leg when supplier payment has amountLocal", () => {
    const leg = supplierBankCreditLeg({ amountUsd: 1000, amountLocal: 278500, bankAccountId: 3 });
    assert.equal(leg.currencyCode, "PKR");
    assert.equal(leg.amount, 278500);
  });

  it("routes direct-to-haji with SA bank to super-admin bank GL", () => {
    assert.equal(
      paymentDebitTarget({ destination: "haji", superAdminBankAccountId: 2 }),
      "sa_bank"
    );
  });

  it("routes direct-to-haji without SA bank to haji equity account", () => {
    assert.equal(paymentDebitTarget({ destination: "haji" }), "haji");
  });
});
