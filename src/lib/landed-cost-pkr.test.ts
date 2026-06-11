import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeLotLandedCostPkr,
  lotCostToPkr,
  lotExpensesByCurrencyToPkr,
} from "@/lib/landed-cost-pkr";

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
});
