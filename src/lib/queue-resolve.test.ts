import test from "node:test";
import assert from "node:assert/strict";
import { getQueueResolvePath, isEditableCustomerQueuedPayload, safeParseQueuedBody } from "@/lib/queue-resolve";

test("safeParseQueuedBody parses valid object payload", () => {
  const parsed = safeParseQueuedBody('{"name":"Ali","cityId":2}');
  assert.deepEqual(parsed, { name: "Ali", cityId: 2 });
});

test("safeParseQueuedBody returns null on malformed body", () => {
  assert.equal(safeParseQueuedBody("{invalid"), null);
});

test("isEditableCustomerQueuedPayload requires a non-empty name", () => {
  assert.equal(isEditableCustomerQueuedPayload({ name: "  " }), false);
  assert.equal(isEditableCustomerQueuedPayload({ cityId: 1 }), false);
  assert.equal(isEditableCustomerQueuedPayload({ name: "Kareem" }), true);
});

test("getQueueResolvePath maps supported entity types", () => {
  assert.equal(getQueueResolvePath("sale"), "/sales");
  assert.equal(getQueueResolvePath("city_transfer"), "/city-transfers");
  assert.equal(getQueueResolvePath("bank_deposit"), "/bank-deposits");
  assert.equal(getQueueResolvePath("supplier"), "/suppliers");
  assert.equal(getQueueResolvePath("intermediary"), "/intermediaries");
  assert.equal(getQueueResolvePath("supplier_payment"), "/suppliers");
  assert.equal(getQueueResolvePath("shipping_line_payment"), "/shipping-lines");
  assert.equal(getQueueResolvePath("super_admin_personal_expense"), "/super-admin-personal-expenses");
  assert.equal(getQueueResolvePath("agent_payment"), "/agents");
  assert.equal(getQueueResolvePath("lot_cost"), "/lots");
  assert.equal(getQueueResolvePath("opening_entry"), "/openings");
  assert.equal(getQueueResolvePath("lot"), "/lots");
  assert.equal(getQueueResolvePath("lot_purchase"), "/lots");
  assert.equal(getQueueResolvePath("product"), "/inventory");
  assert.equal(getQueueResolvePath("shipping_line"), "/shipping-lines");
  assert.equal(getQueueResolvePath("agent"), "/agents");
  assert.equal(getQueueResolvePath("bank_account"), "/settings/bank-accounts");
  assert.equal(getQueueResolvePath("intermediary_deposit"), "/intermediaries");
  assert.equal(getQueueResolvePath("intermediary_exchange"), "/intermediaries");
  assert.equal(getQueueResolvePath("godown_transfer"), "/inventory");
  assert.equal(getQueueResolvePath("investor_transaction"), "/investors");
  assert.equal(getQueueResolvePath("unknown"), null);
});
