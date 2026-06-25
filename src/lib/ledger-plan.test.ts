import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLotCostCurrency, requiresAcquisitionRateToPkr } from "@/lib/lot-cost-currency";
import { buildSupplierStatement, buildSupplierRunningLedger } from "@/lib/supplier-ledger";

describe("lot-cost-currency", () => {
  it("allows PKR only for Pakistan non-freight", () => {
    const ok = resolveLotCostCurrency({ isFreight: false, lotCountryCode: "PAK", requestedCurrency: "PKR" });
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.currencyCode, "PKR");

    const bad = resolveLotCostCurrency({ isFreight: false, lotCountryCode: "PAK", requestedCurrency: "USD" });
    assert.equal(bad.ok, false);
  });

  it("allows USD or CNY for freight on any country", () => {
    const usd = resolveLotCostCurrency({ isFreight: true, lotCountryCode: "PAK", requestedCurrency: "USD" });
    const cny = resolveLotCostCurrency({ isFreight: true, lotCountryCode: "AFG", requestedCurrency: "CNY" });
    assert.equal(usd.ok, true);
    assert.equal(cny.ok, true);
  });

  it("requires acquisition rate for foreign currencies", () => {
    assert.equal(requiresAcquisitionRateToPkr("PKR"), false);
    assert.equal(requiresAcquisitionRateToPkr("USD"), true);
    assert.equal(requiresAcquisitionRateToPkr("CNY"), true);
  });
});

describe("supplier-ledger", () => {
  it("applies lot override before FIFO for payments", () => {
    const supplier = {
      lotPurchases: [
        { id: 1, lotId: 10, qty: 1, totalPriceUsd: 100, createdAt: "2026-01-01", product: { name: "A" }, lot: { lotNumber: "L-10", lotDate: "2026-01-01", country: { name: "PK" } } },
        { id: 2, lotId: 20, qty: 1, totalPriceUsd: 200, createdAt: "2026-02-01", product: { name: "B" }, lot: { lotNumber: "L-20", lotDate: "2026-02-01", country: { name: "PK" } } },
      ],
      supplierPayments: [
        { id: 99, lotId: 20, amountUsd: 150, paymentDate: "2026-03-01", reference: "T1" },
      ],
    };
    const { rows } = buildSupplierStatement(supplier);
    const lot20 = rows.find((r) => r.lotId === 20);
    assert.ok(lot20);
    assert.equal(lot20!.depositUsd, 150);
    assert.equal(lot20!.lotBalanceUsd, 50);
  });

  it("builds one debit per lot in running ledger", () => {
    const supplier = {
      lotPurchases: [
        { id: 1, lotId: 10, totalPriceUsd: 100, createdAt: "2026-01-01", product: { name: "A" }, lot: { lotNumber: "L-10", lotDate: "2026-01-01" } },
        { id: 2, lotId: 10, totalPriceUsd: 50, createdAt: "2026-01-02", product: { name: "B" }, lot: { lotNumber: "L-10", lotDate: "2026-01-01" } },
      ],
      supplierPayments: [{ id: 1, amountUsd: 75, paymentDate: "2026-02-01" }],
    };
    const rows = buildSupplierRunningLedger(supplier);
    assert.equal(rows.filter((r) => r.sourceType === "purchase").length, 1);
    assert.equal(rows[0].debitUsd, 150);
    assert.equal(rows.at(-1)?.balanceUsd, 75);
  });
});
