type LegacyCapitalTransaction = {
  id: number | string;
  type: "deposit" | "withdrawal";
  date: string;
  amountPkr: number;
  notes?: string | null;
};

export type LegacyInvestorAccountReviewInput = {
  investorId: number | string;
  investorName: string;
  accountId: number | string;
  currencyCode: string;
  accountStartDate: string;
  profitType?: string | null;
  profitSharePercent?: number | null;
  fixedRatePercent?: number | null;
  transactions: LegacyCapitalTransaction[];
};

export function buildLegacyInvestorCapitalReview(accounts: LegacyInvestorAccountReviewInput[]) {
  const rows = accounts.map((account) => {
    const currencyCode = account.currencyCode.toUpperCase();
    const deposits = account.transactions.filter((transaction) => transaction.type === "deposit");
    const withdrawals = account.transactions.filter((transaction) => transaction.type === "withdrawal");
    const impliedDepositsPkr = deposits.reduce((sum, transaction) => sum + Number(transaction.amountPkr || 0), 0);
    const impliedWithdrawalsPkr = withdrawals.reduce((sum, transaction) => sum + Number(transaction.amountPkr || 0), 0);
    const impliedCapitalPkr = impliedDepositsPkr - impliedWithdrawalsPkr;
    const sortedTransactions = [...account.transactions].sort((a, b) => a.date.localeCompare(b.date));
    const proposedOpeningEffectiveDate = sortedTransactions[0]?.date || account.accountStartDate;
    const investorProfitSharePercent = account.profitSharePercent == null ? null : Number(account.profitSharePercent);
    const managerProfitSharePercent = investorProfitSharePercent == null ? null : 100 - investorProfitSharePercent;
    const ambiguities: string[] = [];

    if (currencyCode !== "PKR") {
      ambiguities.push(`${currencyCode} legacy account is not auto-converted to PKR.`);
    }
    if (sortedTransactions.length === 0) {
      ambiguities.push("No legacy deposits or withdrawals exist for this account.");
    }
    if (impliedCapitalPkr < 0) {
      ambiguities.push("Withdrawals exceed deposits; opening capital cannot be trusted without review.");
    }
    if (impliedCapitalPkr === 0 && sortedTransactions.length > 0) {
      ambiguities.push("Net capital is zero despite legacy movement; review whether this is a full exit.");
    }
    if (account.profitType === "fixed_rate") {
      ambiguities.push("Legacy fixed-rate account is not the same as investor/manager profit-sharing.");
    }
    if (investorProfitSharePercent == null) {
      ambiguities.push("Legacy profit-share percentage is missing.");
    }

    return {
      investorId: account.investorId,
      investorName: account.investorName,
      accountId: account.accountId,
      currencyCode,
      accountStartDate: account.accountStartDate,
      legacySourceLabel: "Derived from legacy investor transactions",
      impliedDepositsPkr,
      impliedWithdrawalsPkr,
      impliedCapitalPkr,
      proposedOpeningCapitalPkr: currencyCode === "PKR" ? Math.max(0, impliedCapitalPkr) : null,
      proposedOpeningEffectiveDate,
      investorProfitSharePercent,
      managerProfitSharePercent,
      fixedRatePercent: account.fixedRatePercent == null ? null : Number(account.fixedRatePercent),
      transactionCount: sortedTransactions.length,
      capitalEventCandidates: sortedTransactions.map((transaction) => ({
        eventType: transaction.type === "deposit" ? "capital_contribution" : "capital_withdrawal",
        effectiveDate: transaction.date,
        amountPkr: transaction.type === "deposit" ? transaction.amountPkr : -transaction.amountPkr,
        reference: `legacy_${transaction.type}:${transaction.id}`,
        remarks: transaction.notes || null,
      })),
      ambiguities,
    };
  });

  return {
    rows,
    summary: {
      accountCount: rows.length,
      pkrAccountCount: rows.filter((row) => row.currencyCode === "PKR").length,
      proposedOpeningCapitalPkr: rows.reduce((sum, row) => sum + Number(row.proposedOpeningCapitalPkr || 0), 0),
      ambiguousAccountCount: rows.filter((row) => row.ambiguities.length > 0).length,
    },
  };
}
