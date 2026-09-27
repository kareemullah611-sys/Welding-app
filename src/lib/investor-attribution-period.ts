import { resolveAccountingPeriod, type AccountingPeriodInput } from "./accounting-period";

export function resolveInvestorAttributionPeriod(input: AccountingPeriodInput) {
  return resolveAccountingPeriod({ ...input, errorCode: "INVALID_ATTRIBUTION_PERIOD" });
}
