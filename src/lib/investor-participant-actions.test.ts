import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildParticipantBalance, calculateSettlementStatus, consumeProfitSources, validateParticipantAction, validateSettlementAllocation } from "./investor-participant-actions";
import {
  isInvestorFinalizationEnabled,
  isInvestorFxSettlementEnabled,
  isInvestorSettlementEnabled,
} from "./investor-production-gate";

function baseBalance(overrides: any = {}) {
  return buildParticipantBalance({
    participantId: 1,
    capitalEvents: [{ amountPkr: 50_000_000 }],
    finalizationLedgerEntries: [
      { periodId: 10, category: "investor_profit", postingType: "investor_profit_entitlement", amountPkr: 718_750 },
    ],
    actionLedgerEntries: [],
    ...overrides,
  });
}

test("phase 3 partial and full profit withdrawal reduce available profit without reducing capital", () => {
  const before = baseBalance();
  assert.equal(before.currentParticipatingCapitalPkr, 50_000_000);
  assert.equal(before.currentAvailableProfitPkr, 718_750);
  assert.equal(validateParticipantAction({ actionType: "profit_withdrawal", profitAmountPkr: 500_000, capitalAmountPkr: 0, balance: before, participantIsActive: true }), null);

  const afterPartial = buildParticipantBalance({
    participantId: 1,
    capitalEvents: [{ amountPkr: 50_000_000 }],
    finalizationLedgerEntries: [{ periodId: 10, category: "investor_profit", postingType: "investor_profit_entitlement", amountPkr: 718_750 }],
    actionLedgerEntries: [{ category: "finalized_profit_withdrawal", amountPkr: 500_000, sourceFinalizationIds: [{ periodId: 10, category: "investor_profit", postingType: "investor_profit_entitlement", amountPkr: 500_000 }], action: { status: "active", actionType: "profit_withdrawal" } }],
  });
  assert.equal(afterPartial.currentParticipatingCapitalPkr, 50_000_000);
  assert.equal(afterPartial.currentAvailableProfitPkr, 218_750);

  const afterFull = buildParticipantBalance({
    participantId: 1,
    capitalEvents: [{ amountPkr: 50_000_000 }],
    finalizationLedgerEntries: [{ periodId: 10, category: "investor_profit", postingType: "investor_profit_entitlement", amountPkr: 718_750 }],
    actionLedgerEntries: [{ category: "finalized_profit_withdrawal", amountPkr: 718_750, sourceFinalizationIds: [{ periodId: 10, category: "investor_profit", postingType: "investor_profit_entitlement", amountPkr: 718_750 }], action: { status: "active", actionType: "profit_withdrawal" } }],
  });
  assert.equal(afterFull.currentParticipatingCapitalPkr, 50_000_000);
  assert.equal(afterFull.currentAvailableProfitPkr, 0);
});

test("phase 3 blocks profit over-withdrawal and reinvestment above finalized available profit", () => {
  const balance = baseBalance();
  assert.match(validateParticipantAction({ actionType: "profit_withdrawal", profitAmountPkr: 718_751, capitalAmountPkr: 0, balance, participantIsActive: true }) || "", /exceeds available/);
  assert.match(validateParticipantAction({ actionType: "profit_reinvestment", profitAmountPkr: 718_751, capitalAmountPkr: 0, balance, participantIsActive: true }) || "", /Reinvestment exceeds/);
});

test("phase 3 capital withdrawal reduces participating capital and blocks over-withdrawal", () => {
  const balance = baseBalance();
  assert.equal(validateParticipantAction({ actionType: "capital_withdrawal", profitAmountPkr: 0, capitalAmountPkr: 20_000_000, balance, participantIsActive: true }), null);
  const after = buildParticipantBalance({
    participantId: 1,
    capitalEvents: [{ eventType: "opening", amountPkr: 50_000_000 }, { eventType: "capital_withdrawal", amountPkr: -20_000_000 }],
    finalizationLedgerEntries: [],
    actionLedgerEntries: [{ category: "capital_withdrawal", amountPkr: 20_000_000, action: { status: "active", actionType: "capital_withdrawal" } }],
  });
  assert.equal(after.currentParticipatingCapitalPkr, 30_000_000);
  assert.equal(after.capitalWithdrawnPkr, 20_000_000);
  assert.equal(after.capitalReconciliation.differencePkr, 0);
  assert.match(validateParticipantAction({ actionType: "capital_withdrawal", profitAmountPkr: 0, capitalAmountPkr: 50_000_001, balance, participantIsActive: true }) || "", /exceeds current participating capital/);
});

test("phase 3 mixed withdrawal requires explicit portions and posts each component separately", () => {
  const balance = baseBalance();
  assert.match(validateParticipantAction({ actionType: "mixed_withdrawal", profitAmountPkr: 0, capitalAmountPkr: 0, balance, participantIsActive: true }) || "", /requires an explicit/);
  assert.equal(validateParticipantAction({ actionType: "mixed_withdrawal", profitAmountPkr: 200_000, capitalAmountPkr: 3_000_000, balance, participantIsActive: true }), null);
});

test("phase 3 profit reinvestment consumes profit and creates new participating capital boundary", () => {
  const after = buildParticipantBalance({
    participantId: 1,
    capitalEvents: [{ amountPkr: 50_000_000 }, { amountPkr: 718_750 }],
    finalizationLedgerEntries: [{ periodId: 10, category: "investor_profit", postingType: "investor_profit_entitlement", amountPkr: 718_750 }],
    actionLedgerEntries: [{ category: "profit_reinvestment", amountPkr: 718_750, sourceFinalizationIds: [{ periodId: 10, category: "investor_profit", postingType: "investor_profit_entitlement", amountPkr: 718_750 }], action: { status: "active", actionType: "profit_reinvestment" } }],
  });
  assert.equal(after.currentParticipatingCapitalPkr, 50_718_750);
  assert.equal(after.currentAvailableProfitPkr, 0);
  assert.equal(after.profitReinvestedPkr, 718_750);
  assert.equal(after.profitReconciliation.differencePkr, 0);
});

test("phase 3 full exit is blocked until capital and available profit are already zero", () => {
  const balance = baseBalance();
  assert.match(validateParticipantAction({ actionType: "full_exit", profitAmountPkr: 0, capitalAmountPkr: 0, balance, participantIsActive: true }) || "", /capital to be zero/);
  const zeroBalance = buildParticipantBalance({ participantId: 1, capitalEvents: [], finalizationLedgerEntries: [], actionLedgerEntries: [] });
  assert.equal(validateParticipantAction({ actionType: "full_exit", profitAmountPkr: 0, capitalAmountPkr: 0, balance: zeroBalance, participantIsActive: true }), null);
  assert.match(validateParticipantAction({ actionType: "profit_withdrawal", profitAmountPkr: 1, capitalAmountPkr: 0, balance, participantIsActive: false }) || "", /already fully exited/);
});

test("phase 3 later residual gain and residual loss after full exit stay manager residual categories", () => {
  const balance = buildParticipantBalance({
    participantId: 99,
    capitalEvents: [{ amountPkr: 10_000_000 }],
    finalizationLedgerEntries: [
      { periodId: 20, category: "manager_residual", postingType: "exited_residual_gain", amountPkr: 100_000 },
      { periodId: 21, category: "manager_residual", postingType: "exited_residual_loss", amountPkr: 40_000 },
    ],
    actionLedgerEntries: [],
  });
  assert.equal(balance.currentAvailableProfitPkr, 100_000);
  assert.equal(balance.finalizedAllocatedLossPkr, 40_000);
});

test("phase 3 consumed finalized sources prevent double consumption after retry or later action", () => {
  const balance = buildParticipantBalance({
    participantId: 1,
    capitalEvents: [{ amountPkr: 50_000_000 }],
    finalizationLedgerEntries: [{ periodId: 10, category: "investor_profit", postingType: "investor_profit_entitlement", amountPkr: 718_750 }],
    actionLedgerEntries: [{ category: "finalized_profit_withdrawal", amountPkr: 500_000, sourceFinalizationIds: [{ periodId: 10, category: "investor_profit", postingType: "investor_profit_entitlement", amountPkr: 500_000 }], action: { status: "active", actionType: "profit_withdrawal" } }],
  });
  const { consumed, remainingPkr } = consumeProfitSources(balance.finalizedProfitSources, 218_750);
  assert.equal(remainingPkr, 0);
  assert.deepEqual(consumed.map((source) => ({
    periodId: source.periodId,
    category: source.category,
    postingType: source.postingType,
    amountPkr: source.amountPkr,
  })), [{ periodId: 10, category: "investor_profit", postingType: "investor_profit_entitlement", amountPkr: 218_750 }]);
});

test("phase 3.1 settlement design supports partial full over and duplicate settlement states", () => {
  const partial = calculateSettlementStatus(1_000_000, [
    { pkrEquivalent: 400_000, status: "settled", idempotencyKey: "pay-1" },
  ]);
  assert.equal(partial.ok, true);
  assert.equal(partial.status, "partially_settled");
  assert.equal(partial.remainingAmountPkr, 600_000);

  const full = calculateSettlementStatus(1_000_000, [
    { pkrEquivalent: 400_000, status: "settled", idempotencyKey: "pay-1" },
    { pkrEquivalent: 600_000, status: "settled", idempotencyKey: "pay-2" },
  ]);
  assert.equal(full.ok, true);
  assert.equal(full.status, "settled");
  assert.equal(full.remainingAmountPkr, 0);

  const over = calculateSettlementStatus(1_000_000, [
    { pkrEquivalent: 1_000_001, status: "settled", idempotencyKey: "pay-3" },
  ]);
  assert.equal(over.ok, false);
  assert.match(over.message || "", /exceeds/);

  const duplicate = calculateSettlementStatus(1_000_000, [
    { pkrEquivalent: 100, status: "settled", idempotencyKey: "dup" },
    { pkrEquivalent: 100, status: "settled", idempotencyKey: "dup" },
  ]);
  assert.equal(duplicate.ok, false);
  assert.match(duplicate.message || "", /Duplicate/);
});

test("phase 3.2 settlement allocation supports PKR full partial multiple and mixed explicit components", () => {
  assert.equal(validateSettlementAllocation({
    actionType: "profit_withdrawal",
    settlementPkrEquivalent: 1_000_000,
    profitComponentPkr: 1_000_000,
    capitalComponentPkr: 0,
  }), null);
  assert.equal(calculateSettlementStatus(1_000_000, [
    { pkrEquivalent: 400_000, status: "settled", idempotencyKey: "pkr-1" },
    { pkrEquivalent: 600_000, status: "settled", idempotencyKey: "pkr-2" },
  ]).status, "settled");
  assert.equal(validateSettlementAllocation({
    actionType: "mixed_withdrawal",
    settlementPkrEquivalent: 4_000_000,
    profitComponentPkr: 1_000_000,
    capitalComponentPkr: 3_000_000,
  }), null);
  assert.match(validateSettlementAllocation({
    actionType: "mixed_withdrawal",
    settlementPkrEquivalent: 4_000_000,
    profitComponentPkr: 0,
    capitalComponentPkr: 0,
  }) || "", /explicit profit\/capital allocation/);
});

test("phase 3.2 settlement reversal restores remaining obligation without deleting settlement audit", () => {
  const beforeReversal = calculateSettlementStatus(1_000_000, [
    { pkrEquivalent: 1_000_000, status: "settled", idempotencyKey: "settled-once" },
  ]);
  assert.equal(beforeReversal.status, "settled");
  const afterReversal = calculateSettlementStatus(1_000_000, [
    { pkrEquivalent: 1_000_000, status: "reversed", idempotencyKey: "settled-once" },
    { pkrEquivalent: -1_000_000, status: "reversed", idempotencyKey: "settled-once-reversal" },
  ]);
  assert.equal(afterReversal.ok, true);
  assert.equal(afterReversal.status, "unsettled");
  assert.equal(afterReversal.remainingAmountPkr, 1_000_000);
});

test("phase 3.2 foreign settlement requires FX and keeps the action PKR based", () => {
  const usdSettlementAmount = 10_000;
  const exchangeRate = 280;
  const pkrEquivalent = usdSettlementAmount * exchangeRate;
  assert.equal(pkrEquivalent, 2_800_000);
  assert.equal(validateSettlementAllocation({
    actionType: "capital_withdrawal",
    settlementPkrEquivalent: pkrEquivalent,
    profitComponentPkr: 0,
    capitalComponentPkr: 2_800_000,
  }), null);
  assert.match(validateSettlementAllocation({
    actionType: "capital_withdrawal",
    settlementPkrEquivalent: pkrEquivalent,
    profitComponentPkr: 2_800_000,
    capitalComponentPkr: 0,
  }) || "", /allocate fully to capital/);
});

test("phase 3 reversal removes original action from balance without deleting audit trail", () => {
  const balance = buildParticipantBalance({
    participantId: 1,
    capitalEvents: [{ amountPkr: 50_000_000 }],
    finalizationLedgerEntries: [{ periodId: 10, category: "investor_profit", postingType: "investor_profit_entitlement", amountPkr: 718_750 }],
    actionLedgerEntries: [
      { category: "finalized_profit_withdrawal", amountPkr: 500_000, sourceFinalizationIds: [{ periodId: 10, category: "investor_profit", postingType: "investor_profit_entitlement", amountPkr: 500_000 }], action: { status: "reversed", actionType: "profit_withdrawal" } },
      { category: "reversal", amountPkr: -500_000, action: { status: "active", actionType: "reversal" } },
    ],
  });
  assert.equal(balance.currentAvailableProfitPkr, 718_750);
});

test("phase 3 implementation is investor-side only and not a business expense", () => {
  const route = readFileSync("src/app/api/v1/investment-participants/[id]/actions/route.ts", "utf8");
  const settlementRoute = readFileSync("src/app/api/v1/investment-participants/[id]/actions/[actionId]/settlements/route.ts", "utf8");
  const settlementPaymentRoute = readFileSync("src/app/api/v1/investment-participants/[id]/actions/[actionId]/settlements/[settlementId]/payments/route.ts", "utf8");
  const finalizationRoute = readFileSync("src/app/api/v1/investor-attribution/route.ts", "utf8");
  const capitalEventsRoute = readFileSync("src/app/api/v1/investment-participants/[id]/capital-events/route.ts", "utf8");
  const profitShareEventsRoute = readFileSync("src/app/api/v1/investment-participants/[id]/profit-share-events/route.ts", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20260813110000_investor_participant_actions/migration.sql", "utf8");
  const settlementMigration = readFileSync("prisma/migrations/20260813120000_investor_settlement_linkage_design/migration.sql", "utf8");
  const settlementExecutionMigration = readFileSync("prisma/migrations/20260813130000_investor_settlement_execution_metadata/migration.sql", "utf8");
  const settlementPaymentMigration = readFileSync("prisma/migrations/20260813140000_investor_settlement_payment_linkage/migration.sql", "utf8");
  const accounting = readFileSync("src/lib/accounting.ts", "utf8");
  const bankAccountsRoute = readFileSync("src/app/api/v1/bank-accounts/route.ts", "utf8");
  const bankAccountLedgerRoute = readFileSync("src/app/api/v1/bank-accounts/[id]/route.ts", "utf8");
  const financialReportRoute = readFileSync("src/app/api/v1/financial-reports/route.ts", "utf8");
  const authoritativeFinancialReport = readFileSync("src/lib/authoritative-financial-report.ts", "utf8");
  const page = readFileSync("src/app/(dashboard)/investors/page.tsx", "utf8");

  assert.match(schema, /model InvestmentParticipantAction/);
  assert.match(schema, /model InvestmentParticipantActionLedgerEntry/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS "investment_participant_actions"/);
  assert.match(settlementMigration, /CREATE TABLE IF NOT EXISTS "investment_participant_settlements"/);
  assert.match(settlementExecutionMigration, /profit_component_pkr/);
  assert.match(settlementExecutionMigration, /selected_rate_type/);
  assert.match(schema, /model InvestmentParticipantSettlement/);
  assert.match(schema, /profitComponentPkr/);
  assert.match(schema, /capitalComponentPkr/);
  assert.match(schema, /model InvestmentParticipantSettlementPayment/);
  assert.match(settlementPaymentMigration, /CREATE TABLE IF NOT EXISTS "investment_participant_settlement_payments"/);
  assert.match(route, /prisma\.\$transaction/);
  assert.match(route, /pg_advisory_xact_lock/);
  assert.match(route, /DUPLICATE_INVESTOR_ACTION/);
  assert.match(route, /actionType === "reversal"/);
  assert.match(route, /investmentCapitalEvent\.create/);
  assert.match(route, /investmentParticipantActionLedgerEntry\.createMany/);
  assert.match(route, /FULL_EXIT_BALANCE_REMAINS/);
  assert.match(route, /FULL_EXIT_UNSETTLED_ACTIONS/);
  assert.match(route, /user\.role !== "super_admin"/);
  assert.match(route, /isInvestorSettlementEnabled/);
  assert.match(route, /FEATURE_DISABLED/);
  assert.match(page, /Withdraw Profit/);
  assert.match(page, /Withdraw Capital/);
  assert.match(page, /Mixed Withdrawal/);
  assert.match(page, /Reinvest Profit/);
  assert.match(page, /Full Exit/);
  assert.match(page, /Settlement/);
  assert.match(page, /Add settlement/);
  assert.match(page, /Reverse/);
  assert.match(settlementRoute, /prisma\.\$transaction/);
  assert.match(settlementRoute, /pg_advisory_xact_lock/);
  assert.match(settlementRoute, /ACTION_NOT_SETTLEABLE/);
  assert.match(settlementRoute, /ACTION_ALREADY_SETTLED/);
  assert.match(settlementRoute, /DUPLICATE_SETTLEMENT_REFERENCE/);
  assert.match(settlementRoute, /MISSING_FX_RATE/);
  assert.match(settlementRoute, /validateSettlementAllocation/);
  assert.match(settlementRoute, /investmentParticipantSettlement\.create/);
  assert.match(settlementRoute, /investmentParticipantAction\.update/);
  assert.match(settlementRoute, /requireSuperAdmin/);
  assert.match(settlementRoute, /isInvestorSettlementEnabled/);
  assert.match(settlementRoute, /isInvestorFxSettlementEnabled/);
  assert.match(settlementRoute, /FX_SETTLEMENT_DISABLED/);
  assert.match(settlementRoute, /FX_PKR_EQUIVALENT_REQUIRED/);
  assert.match(settlementRoute, /FX_PKR_EQUIVALENT_MISMATCH/);
  assert.match(settlementPaymentRoute, /createJournalEntries/);
  assert.match(settlementPaymentRoute, /getInvestorSettlementPayableAccountId/);
  assert.match(settlementPaymentRoute, /getSuperAdminBankGLAccountId/);
  assert.match(settlementPaymentRoute, /getSuperAdminCashGLAccountId/);
  assert.match(settlementPaymentRoute, /reverseJournalEntries/);
  assert.match(settlementPaymentRoute, /OVER_PAYMENT/);
  assert.match(settlementPaymentRoute, /DUPLICATE_PAYMENT_REFERENCE/);
  assert.match(settlementPaymentRoute, /user\.role !== "super_admin"/);
  assert.match(settlementPaymentRoute, /isInvestorSettlementEnabled/);
  assert.match(settlementPaymentRoute, /isInvestorFxSettlementEnabled/);
  assert.match(settlementPaymentRoute, /FX_SETTLEMENT_DISABLED/);
  assert.match(settlementPaymentRoute, /FX_PKR_EQUIVALENT_REQUIRED/);
  assert.match(settlementPaymentRoute, /FX_PKR_EQUIVALENT_MISMATCH/);
  assert.match(finalizationRoute, /user\.role !== "super_admin"/);
  assert.match(finalizationRoute, /isInvestorFinalizationEnabled/);
  assert.match(finalizationRoute, /FEATURE_DISABLED/);
  assert.match(capitalEventsRoute, /user\.role !== "super_admin"/);
  assert.match(profitShareEventsRoute, /user\.role !== "super_admin"/);
  assert.match(accounting, /Investor Settlement Payable/);
  assert.match(accounting, /"liability"/);
  assert.match(bankAccountsRoute, /investmentParticipantSettlementPayment\.groupBy/);
  assert.match(bankAccountLedgerRoute, /Investor Settlement/);
  assert.match(page, /Record Settlement Payment/);
  assert.match(page, /Record payment/);
  assert.match(page, /Reverse payment/);
  assert.match(financialReportRoute, /buildAuthoritativeFinancialReportResult/);
  assert.match(authoritativeFinancialReport, /account\.accountType === "revenue"/);
  assert.match(authoritativeFinancialReport, /account\.accountType === "cogs"/);
  assert.match(authoritativeFinancialReport, /account\.accountType === "expense"/);
  assert.doesNotMatch(financialReportRoute, /Investor Settlement Payable/);

  assert.doesNotMatch(route, /journalEntry\.(create|createMany|update|delete)/);
  assert.doesNotMatch(route, /expense\.(create|createMany|update|delete)/);
  assert.doesNotMatch(route, /payment\.(create|createMany|update|delete)/);
  assert.doesNotMatch(route, /bankDeposit\.(create|createMany|update|delete)/);
  assert.doesNotMatch(route, /cashLedger|runningBalance/i);
  assert.doesNotMatch(settlementRoute, /journalEntry\.(create|createMany|update|delete)/);
  assert.doesNotMatch(settlementRoute, /expense\.(create|createMany|update|delete)/);
  assert.doesNotMatch(settlementRoute, /payment\.(create|createMany|update|delete)/);
  assert.doesNotMatch(settlementRoute, /bankDeposit\.(create|createMany|update|delete)/);
  assert.doesNotMatch(settlementRoute, /cashLedger|runningBalance/i);
  assert.doesNotMatch(settlementPaymentRoute, /expense\.(create|createMany|update|delete)/);
  assert.doesNotMatch(settlementPaymentRoute, /payment\.(create|createMany|update|delete)/);
  assert.doesNotMatch(settlementPaymentRoute, /bankDeposit\.(create|createMany|update|delete)/);
  assert.doesNotMatch(settlementPaymentRoute, /accountType: "expense"|accountType: "revenue"|accountType: "cogs"/);
});

test("production investor feature flags default closed and can be enabled independently", () => {
  assert.equal(isInvestorFinalizationEnabled({}), false);
  assert.equal(isInvestorSettlementEnabled({}), false);
  assert.equal(isInvestorFxSettlementEnabled({}), false);
  assert.equal(isInvestorFinalizationEnabled({ INVESTOR_FINALIZATION_ENABLED: "true" }), true);
  assert.equal(isInvestorSettlementEnabled({ INVESTOR_SETTLEMENT_ENABLED: "1" }), true);
  assert.equal(isInvestorFxSettlementEnabled({ INVESTOR_FX_SETTLEMENT_ENABLED: "yes" }), true);
  assert.equal(isInvestorSettlementEnabled({ INVESTOR_SETTLEMENT_ENABLED: "false" }), false);
});

test("finalized opening profit is available without being capitalized", () => {
  const balance = buildParticipantBalance({
    participantId: 7,
    capitalEvents: [{ eventType: "opening", amountPkr: 10_000_000 }],
    finalizationLedgerEntries: [],
    actionLedgerEntries: [],
    openingProfitBalances: [{ id: 91, currentYearProfitPkr: 1_200_000, ongoingLotRealizedProfitPkr: 300_000 }],
  });
  assert.equal(balance.currentParticipatingCapitalPkr, 10_000_000);
  assert.equal(balance.currentAvailableProfitPkr, 1_500_000);
  assert.equal(balance.finalizedProfitSources[0].sourceType, "opening_participant_balance");
});
