import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIntermediaryLedgerEntries,
  formatExchangeLedgerDescription,
  paginateIntermediaryLedger,
} from "@/lib/intermediary-ledger";

test("formats exchange ledger description with @ rate", () => {
  assert.equal(formatExchangeLedgerDescription("USD", "PKR", 280), "FX USD→PKR @ 280");
  assert.equal(formatExchangeLedgerDescription("USD", "PKR", 280.5, "Bank rate"), "FX USD→PKR @ 280.5 — Bank rate");
});

test("includes exchange rate in intermediary ledger entries", () => {
  const entries = buildIntermediaryLedgerEntries({
    deposits: [],
    payments: [],
    exchanges: [
      {
        id: 3,
        exchangeDate: new Date("2026-06-03"),
        fromAmount: 100,
        toAmount: 28000,
        exchangeRate: 280,
        notes: null,
        fromCurrency: { code: "USD" },
        toCurrency: { code: "PKR" },
      },
    ],
    hajiTransfers: [],
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[0].description, "FX USD→PKR @ 280");
  assert.equal(entries[1].description, "FX USD→PKR @ 280");
});

test("includes haji transfers settled through intermediary in ledger entries", () => {
  const entries = buildIntermediaryLedgerEntries({
    deposits: [],
    payments: [],
    exchanges: [],
    hajiTransfers: [
      {
        id: 9,
        transferDate: new Date("2026-06-01"),
        amount: 250000,
        detail: "Monthly settlement",
        notes: null,
        currency: { code: "AFN" },
        city: { name: "Abdul Khaliq" },
      },
    ],
  });

  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "haji_transfer");
  assert.equal(entries[0].currencyCode, "AFN");
  assert.equal(entries[0].credit, 250000);
  assert.equal(entries[0].description, "Abdul Khaliq — Monthly settlement");
});

test("haji transfer ledger description shows city only when detail is empty", () => {
  const entries = buildIntermediaryLedgerEntries({
    deposits: [],
    payments: [],
    exchanges: [],
    hajiTransfers: [
      {
        id: 10,
        transferDate: new Date("2026-06-01"),
        amount: 100,
        detail: "",
        currency: { code: "AFN" },
        city: { name: "Abdul Khaliq" },
      },
    ],
  });

  assert.equal(entries[0].description, "Abdul Khaliq");
});

test("paginates merged intermediary ledger after running balances", () => {
  const entries = buildIntermediaryLedgerEntries({
    deposits: [
      {
        id: 1,
        depositDate: new Date("2026-06-01"),
        amount: 100,
        currency: { code: "USD" },
      },
    ],
    payments: [],
    exchanges: [],
    hajiTransfers: [
      {
        id: 2,
        transferDate: new Date("2026-06-02"),
        amount: 50,
        detail: "نقد",
        currency: { code: "USD" },
        city: { name: "City A" },
      },
    ],
  });

  const page = paginateIntermediaryLedger(entries, 1, 20);
  assert.equal(page.pagination.total, 2);
  assert.equal(page.ledger.length, 2);
  assert.equal(page.balances.USD, -150);
});
