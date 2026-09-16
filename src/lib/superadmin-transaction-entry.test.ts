import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

test("superadmin transaction entry stays a frontend orchestration layer", () => {
  const modal = read("src/components/transactions/SuperAdminTransactionModal.tsx");
  const definitions = read("src/lib/superadmin-transactions.ts");
  const layout = read("src/components/layout/AppLayout.tsx");

  assert.match(layout, /user\.role === "super_admin"/);
  assert.match(layout, /SuperAdminTransactionModal/);
  assert.match(modal, /What would you like to record\?/);
  assert.match(modal, /Review financial effect/);
  assert.match(modal, /Transaction recorded/);

  for (const endpoint of [
    "/api/v1/super-admin-account-transfers",
    "/api/v1/supplier-payments",
    "/api/v1/shipping-line-payments",
    "/api/v1/agent-payments",
    "/api/v1/intermediaries/",
    "/api/v1/haji-cash-receipts",
    "/api/v1/super-admin-liabilities/",
    "/api/v1/super-admin-personal-expenses",
  ]) {
    assert.match(modal, new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.doesNotMatch(modal, /\/api\/v1\/transactions/);
  assert.doesNotMatch(modal, /\/api\/v1\/investment-participants/);
  assert.match(modal, /function accountKey/);
  assert.doesNotMatch(definitions, /transaction history/i);
  assert.match(definitions, /investor_capital_withdrawal/);
  assert.match(definitions, /implementationStatus: "deferred"/);
});

test("existing superadmin modules can launch the shared transaction entry", () => {
  const paths = [
    "src/app/(dashboard)/super-admin-account-transfers/page.tsx",
    "src/app/(dashboard)/suppliers/page.tsx",
    "src/app/(dashboard)/shipping-lines/page.tsx",
    "src/app/(dashboard)/agents/page.tsx",
    "src/app/(dashboard)/super-admin-liabilities/page.tsx",
    "src/app/(dashboard)/super-admin-personal-expenses/page.tsx",
    "src/app/(dashboard)/intermediaries/page.tsx",
    "src/app/(dashboard)/settings/bank-accounts/page.tsx",
  ];

  for (const path of paths) {
    assert.match(read(path), /openSuperAdminTransaction/);
  }
});

test("investor settlement history remains untouched pending migration review", () => {
  const investorPage = read("src/app/(dashboard)/investors/page.tsx");
  const schema = read("prisma/schema.prisma");

  assert.match(investorPage, /profit_withdrawal/);
  assert.match(investorPage, /mixed_withdrawal/);
  assert.match(investorPage, /remainingSettlementPkr/);
  assert.match(schema, /InvestmentParticipantSettlement/);
  assert.match(schema, /InvestmentParticipantSettlementPayment/);
});

test("account transfer submission is idempotent across retries", () => {
  const modal = read("src/components/transactions/SuperAdminTransactionModal.tsx");
  const route = read("src/app/api/v1/super-admin-account-transfers/route.ts");

  assert.match(modal, /transferRequestRef/);
  assert.match(modal, /x-sync-request-id/);
  assert.match(route, /getSyncRequestMeta/);
  assert.match(route, /SUPER_ADMIN_ACCOUNT_TRANSFER_SYNC_MODULE/);
  assert.match(route, /tx\.syncRequest\.create/);
  assert.match(route, /sync:\$\{SUPER_ADMIN_ACCOUNT_TRANSFER_SYNC_MODULE\}:\$\{syncMeta\.requestId\}/);
  assert.match(route, /if \(existingSync\?\.entityId\)/);
});
