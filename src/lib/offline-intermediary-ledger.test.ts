import assert from "node:assert/strict";
import test from "node:test";
import { applyPendingIntermediaryLedger } from "@/lib/offline-intermediary-ledger";

test("applies pending intermediary deposits and exchanges to ledger", () => {
  const base = {
    balances: { PKR: 1000, USD: 10 },
    ledger: [],
    depositHistory: [],
    exchangeHistory: [],
  };
  const queued = [
    {
      id: "q1",
      url: "/api/v1/intermediaries/5/deposits",
      method: "POST",
      body: JSON.stringify({ depositDate: "2026-04-29", amount: 500, currencyId: 1, notes: "cash" }),
    },
    {
      id: "q2",
      url: "/api/v1/intermediaries/5/exchanges",
      method: "POST",
      body: JSON.stringify({
        exchangeDate: "2026-04-29",
        baseCurrencyId: 2,
        quoteCurrencyId: 1,
        fromCurrencyId: 2,
        toCurrencyId: 1,
        fromAmount: 10,
        exchangeRate: 280,
      }),
    },
  ];
  const currencies = [
    { id: 1, code: "PKR" },
    { id: 2, code: "USD" },
  ];

  const merged = applyPendingIntermediaryLedger(base, queued as any, 5, currencies as any);
  assert.equal(merged.ledger.length, 3);
  assert.equal(merged.depositHistory.length, 1);
  assert.equal(merged.exchangeHistory.length, 1);
  assert.equal(merged.balances.PKR, 4300);
  assert.equal(merged.balances.USD, 0);
  assert.equal(merged.ledger[0]._pending, true);
});
