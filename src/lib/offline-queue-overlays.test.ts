import assert from "node:assert/strict";
import test from "node:test";
import {
  getPendingAgents,
  getPendingBankDeposits,
  getPendingCityTransfers,
  getPendingGodowns,
  getPendingInvestors,
  getPendingIntermediaries,
  getPendingLots,
  getPendingProducts,
  getPendingShippingLines,
  getPendingSuppliers,
  getPendingSuperAdminPersonalExpenses,
  getPendingUsers,
} from "@/lib/offline-queue-overlays";

test("builds pending city transfer rows from queued entries", () => {
  const rows = getPendingCityTransfers([
    { id: "1", method: "POST", url: "/api/v1/city-transfers", body: JSON.stringify({ qty: 5, transferDate: "2026-04-29" }) },
    { id: "2", method: "POST", url: "/api/v1/payments", body: "{}" },
  ] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].qty, 5);
  assert.equal(rows[0]._pending, true);
});

test("builds pending bank deposit rows from queued entries", () => {
  const rows = getPendingBankDeposits([
    { id: "1", method: "POST", url: "/api/v1/bank-deposits", body: JSON.stringify({ cashAmount: 1200, transferType: "bank_to_cash" }) },
  ] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cashAmount, 1200);
  assert.equal(rows[0].transferType, "bank_to_cash");
});

test("builds pending suppliers rows from queued entries", () => {
  const rows = getPendingSuppliers([
    { id: "1", method: "POST", url: "/api/v1/suppliers", body: JSON.stringify({ name: "ABC" }) },
  ] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "ABC");
  assert.equal(rows[0]._pending, true);
});

test("builds pending agents rows", () => {
  const rows = getPendingAgents([{ id: "1", method: "POST", url: "/api/v1/agents", body: JSON.stringify({ name: "Agent A" }) }] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Agent A");
});

test("builds pending shipping lines rows", () => {
  const rows = getPendingShippingLines([{ id: "1", method: "POST", url: "/api/v1/shipping-lines", body: JSON.stringify({ name: "Line A" }) }] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Line A");
});

test("builds pending godown rows", () => {
  const rows = getPendingGodowns([{ id: "1", method: "POST", url: "/api/v1/godowns", body: JSON.stringify({ name: "G1" }) }] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "G1");
});

test("builds pending investor rows", () => {
  const rows = getPendingInvestors([{ id: "1", method: "POST", url: "/api/v1/investors", body: JSON.stringify({ name: "Inv A" }) }] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Inv A");
});

test("builds pending super-admin personal expense rows", () => {
  const rows = getPendingSuperAdminPersonalExpenses([{ id: "1", method: "POST", url: "/api/v1/super-admin-personal-expenses", body: JSON.stringify({ amount: 500 }) }] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 500);
});

test("builds pending lot rows", () => {
  const rows = getPendingLots([{ id: "1", method: "POST", url: "/api/v1/lots", body: JSON.stringify({ lotNumber: "L-001" }) }] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lotNumber, "L-001");
});

test("builds pending intermediary rows", () => {
  const rows = getPendingIntermediaries([{ id: "1", method: "POST", url: "/api/v1/intermediaries", body: JSON.stringify({ name: "Ishaq" }) }] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Ishaq");
});

test("builds pending product rows", () => {
  const rows = getPendingProducts([{ id: "1", method: "POST", url: "/api/v1/products", body: JSON.stringify({ name: "3.2mm" }) }] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "3.2mm");
});

test("builds pending user rows", () => {
  const rows = getPendingUsers([{ id: "1", method: "POST", url: "/api/v1/users", body: JSON.stringify({ fullName: "Lahore Admin", username: "lahore", role: "city_admin" }) }] as any);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fullName, "Lahore Admin");
  assert.equal(rows[0].role, "city_admin");
});
