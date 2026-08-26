import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeLotLandedCostPkr,
  lotCostToPkr,
  lotExpensesByCurrencyToPkr,
} from "@/lib/landed-cost-pkr";
import { buildLotCostLedger } from "@/lib/lot-cost-ledger";

describe("landed-cost-pkr", () => {
  it("converts USD purchase + freight + PKR customs using lot USD/PKR rate", () => {
    const result = computeLotLandedCostPkr({
      totalPurchaseUsd: 1000,
      totalCartons: 100,
      usdPkrRate: 280,
      lotCosts: [
        { costType: "freight", amount: 100, currencyCode: "USD", exchangeRate: 280 },
        { costType: "customs", amount: 50_000, currencyCode: "PKR" },
      ],
      lotExpensesByCurrency: {},
    });

    assert.equal(result.purchasePkr, 280_000);
    assert.equal(result.freightPkr, 28_000);
    assert.equal(result.nonFreightCostsPkr, 50_000);
    assert.equal(result.totalLandedCostPkr, 358_000);
    assert.equal(result.landedCostPerCartonPkr, 3580);
  });

  it("converts AFN lot costs via stored AFN→PKR rate", () => {
    assert.equal(
      lotCostToPkr({ amount: 1000, currencyCode: "AFN", exchangeRate: 3.5 }, 280),
      3500
    );
  });

  it("converts CNY lot costs via stored CNY→PKR rate", () => {
    assert.equal(
      lotCostToPkr({ amount: 500, currencyCode: "CNY", exchangeRate: 38 }, 280),
      19_000
    );
  });

  it("includes lot expenses in landed cost once (PKR + USD)", () => {
    const expensesPkr = lotExpensesByCurrencyToPkr({ PKR: 10_000, USD: 50 }, 280, 0);
    assert.equal(expensesPkr, 10_000 + 50 * 280);

    const result = computeLotLandedCostPkr({
      totalPurchaseUsd: 0,
      totalCartons: 10,
      usdPkrRate: 280,
      lotCosts: [],
      lotExpensesByCurrency: { PKR: 10_000 },
    });
    assert.equal(result.lotExpensesPkr, 10_000);
    assert.equal(result.totalLandedCostPkr, 10_000);
  });

  it("does not silently drop a foreign cost when its required FX rate is missing", () => {
    assert.throws(
      () => lotCostToPkr({ amount: 1000, currencyCode: "AFN", exchangeRate: null }, 280),
      /missing.*AFN.*PKR/i,
    );
  });

  it("does not silently drop foreign lot expenses when their required FX rate is missing", () => {
    assert.throws(
      () => lotExpensesByCurrencyToPkr({ AFN: 1000 }, 280, 0),
      /missing.*AFN.*PKR/i,
    );
  });

  it("uses the lot USD/PKR recognition rate for unpaid purchase rows", () => {
    const result = buildLotCostLedger({
      lotDate: "2026-08-22",
      lotCountryCode: "PK",
      usdPkrRate: 283,
      purchaseItems: [
        { id: 1, supplierName: "Supplier", productName: "Product", totalPriceUsd: 1_000 },
      ],
      lotCosts: [],
      lotExpensesByCurrency: {},
    });

    assert.equal(result.rows[0]?.amountPkr, 283_000);
    assert.equal(result.rows[0]?.acquisitionRateToPkr, 283);
  });

  it("does not let a later supplier settlement rate rewrite the lot recognition basis", () => {
    const result = buildLotCostLedger({
      lotDate: "2026-08-22",
      lotCountryCode: "PK",
      usdPkrRate: 283,
      purchaseItems: [
        { id: 1, supplierName: "Supplier", productName: "Product", totalPriceUsd: 1_000 },
      ],
      lotCosts: [],
      lotExpensesByCurrency: {},
      supplierPaymentsForLot: [{ amountUsd: 400, exchangeRate: 287 }],
    });

    assert.equal(result.rows[0]?.amountPkr, 283_000);
    assert.equal(result.rows[0]?.acquisitionRateToPkr, 283);
  });
});
