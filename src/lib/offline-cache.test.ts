import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApiCacheKey,
  buildOfflineAuditMeta,
  isPackagedOfflineRuntime,
  shouldAutoQueueOfflineWrite,
  shouldQueueOfflineWriteNow,
  shouldQueueOfflineWriteOnNetworkFailure,
  shouldUseOfflineApiCache,
} from "@/lib/offline-cache";
import { setPackagedServerReachable } from "@/lib/offline-reachability";

test("buildApiCacheKey sorts params deterministically", () => {
  const keyA = buildApiCacheKey("/api/v1/sales", { limit: 20, page: 2, q: "abc" });
  const keyB = buildApiCacheKey("/api/v1/sales", { q: "abc", page: 2, limit: 20 });
  assert.equal(keyA, keyB);
  assert.equal(keyA, "/api/v1/sales?limit=20&page=2&q=abc");
});

test("buildApiCacheKey omits empty params", () => {
  const key = buildApiCacheKey("/api/v1/payments", { q: "", page: 1, status: undefined });
  assert.equal(key, "/api/v1/payments?page=1");
});

test("shouldAutoQueueOfflineWrite only queues allowlisted POST create routes", () => {
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/payments", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/customers", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/suppliers", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/intermediaries", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/supplier-payments", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/shipping-line-payments", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/super-admin-personal-expenses", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/agent-payments", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/lot-costs", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/openings", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/lots", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/lot-purchases", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/products", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/shipping-lines", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/agents", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/bank-accounts", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/city-transfers", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/godowns/transfers", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/intermediaries/9/deposits", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/intermediaries/9/exchanges", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/investors/7/transactions", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/customers/1", "PUT"), false);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/auth/login", "POST"), false);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/auth/me", "GET"), false);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/payments", "GET"), false);
  assert.equal(shouldAutoQueueOfflineWrite("https://example.com/api/v1/payments?x=1", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/api/v1/payments?city_id=1", "POST"), true);
  assert.equal(shouldAutoQueueOfflineWrite("/external", "POST"), false);
});

test("buildOfflineAuditMeta maps allowlisted routes to concrete entity metadata", () => {
  const customerMeta = buildOfflineAuditMeta("/api/v1/customers", "POST", { name: "Ali" });
  assert.equal(customerMeta.entityType, "customer");
  assert.equal(customerMeta.entityLabel, "Customer");
  assert.equal(customerMeta.entityDetail, "Customer: Ali");

  const paymentMeta = buildOfflineAuditMeta("/api/v1/payments", "POST", { detail: "walk-in cash" });
  assert.equal(paymentMeta.entityType, "payment");
  assert.equal(paymentMeta.entityDetail, "Detail: walk-in cash");

  const supplierMeta = buildOfflineAuditMeta("/api/v1/suppliers", "POST", { name: "ABC Metals" });
  assert.equal(supplierMeta.entityType, "supplier");
  assert.equal(supplierMeta.entityDetail, "Supplier: ABC Metals");

  const supplierPaymentMeta = buildOfflineAuditMeta("/api/v1/supplier-payments", "POST", { amountUsd: 1234 });
  assert.equal(supplierPaymentMeta.entityType, "supplier_payment");
  assert.equal(supplierPaymentMeta.entityDetail, "Amount USD: 1234");

  const homeExpenseMeta = buildOfflineAuditMeta("/api/v1/super-admin-personal-expenses", "POST", { amount: 999 });
  assert.equal(homeExpenseMeta.entityType, "super_admin_personal_expense");
  assert.equal(homeExpenseMeta.entityDetail, "Amount: 999");

  const lotCostMeta = buildOfflineAuditMeta("/api/v1/lot-costs", "POST", { amount: 555 });
  assert.equal(lotCostMeta.entityType, "lot_cost");
  assert.equal(lotCostMeta.entityDetail, "Amount: 555");

  const openingMeta = buildOfflineAuditMeta("/api/v1/openings", "POST", { kind: "cash" });
  assert.equal(openingMeta.entityType, "opening_entry");
  assert.equal(openingMeta.entityDetail, "Kind: cash");

  const intermediaryDepositMeta = buildOfflineAuditMeta("/api/v1/intermediaries/9/deposits", "POST", { amount: 1250 });
  assert.equal(intermediaryDepositMeta.entityType, "intermediary_deposit");
  assert.equal(intermediaryDepositMeta.entityDetail, "Amount: 1250");

  const intermediaryExchangeMeta = buildOfflineAuditMeta("/api/v1/intermediaries/9/exchanges", "POST", { fromAmount: 350 });
  assert.equal(intermediaryExchangeMeta.entityType, "intermediary_exchange");
  assert.equal(intermediaryExchangeMeta.entityDetail, "From Amount: 350");

  const productMeta = buildOfflineAuditMeta("/api/v1/products", "POST", { name: "2.5mm" });
  assert.equal(productMeta.entityType, "product");
  assert.equal(productMeta.entityDetail, "Product: 2.5mm");

  const lotMeta = buildOfflineAuditMeta("/api/v1/lots", "POST", { lotNumber: "JBP-900" });
  assert.equal(lotMeta.entityType, "lot");
  assert.equal(lotMeta.entityDetail, "Lot: JBP-900");

  const investorTxnMeta = buildOfflineAuditMeta("/api/v1/investors/9/transactions", "POST", { type: "deposit" });
  assert.equal(investorTxnMeta.entityType, "investor_transaction");
  assert.equal(investorTxnMeta.entityDetail, "Type: deposit");
});

test("buildOfflineAuditMeta falls back to generic metadata for unknown routes", () => {
  const meta = buildOfflineAuditMeta("/api/v1/unknown-create", "POST", { kind: "cash" });
  assert.equal(meta.entityType, "offline_entry");
  assert.equal(meta.entityLabel, "Offline Entry");
  assert.equal(meta.entityDetail, "POST /api/v1/unknown-create");
});

test("shouldQueueOfflineWriteNow is disabled in browser even when server unreachable", () => {
  const g = globalThis as typeof globalThis & { window?: Window };
  const prev = g.window;
  g.window = { platformInfo: undefined, Capacitor: undefined } as Window;
  setPackagedServerReachable(false);
  try {
    assert.equal(isPackagedOfflineRuntime(), false);
    assert.equal(shouldQueueOfflineWriteNow("/api/v1/payments", "POST"), false);
  } finally {
    g.window = prev;
    setPackagedServerReachable(true);
  }
});

test("shouldQueueOfflineWriteNow requires packaged app, unreachable server, and allowlisted route", () => {
  const g = globalThis as typeof globalThis & { window?: Window };
  const prev = g.window;
  g.window = { platformInfo: { runtime: "electron" } } as Window;
  setPackagedServerReachable(true);
  try {
    assert.equal(isPackagedOfflineRuntime(), true);
    assert.equal(shouldQueueOfflineWriteNow("/api/v1/payments", "POST"), false);
    setPackagedServerReachable(false);
    assert.equal(shouldQueueOfflineWriteNow("/api/v1/payments", "POST"), true);
  assert.equal(shouldQueueOfflineWriteNow("/api/v1/openings", "POST"), true);
  assert.equal(shouldQueueOfflineWriteNow("/api/v1/lots", "POST"), true);
  assert.equal(shouldQueueOfflineWriteOnNetworkFailure("/api/v1/payments", "POST"), true);
  assert.equal(shouldQueueOfflineWriteOnNetworkFailure("/api/v1/payments", "PUT"), false);
  } finally {
    g.window = prev;
    setPackagedServerReachable(true);
  }
});

test("shouldUseOfflineApiCache is true for all packaged runtimes", () => {
  const g = globalThis as typeof globalThis & { window?: Window };
  const prev = g.window;
  g.window = { platformInfo: { runtime: "electron" } } as Window;
  setPackagedServerReachable(true);
  try {
    assert.equal(shouldUseOfflineApiCache(), true);
    setPackagedServerReachable(false);
    assert.equal(shouldUseOfflineApiCache(), true);
  } finally {
    g.window = prev;
    setPackagedServerReachable(false);
  }
  g.window = {} as Window;
  try {
    assert.equal(shouldUseOfflineApiCache(), false);
  } finally {
    g.window = prev;
    setPackagedServerReachable(false);
  }
});
