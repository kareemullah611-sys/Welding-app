export const INVESTOR_FINALIZATION_FLAG = "INVESTOR_FINALIZATION_ENABLED";
export const INVESTOR_SETTLEMENT_FLAG = "INVESTOR_SETTLEMENT_ENABLED";
export const INVESTOR_FX_SETTLEMENT_FLAG = "INVESTOR_FX_SETTLEMENT_ENABLED";

type FeatureFlagEnv = Record<string, string | undefined>;

export function isProductionFeatureEnabled(name: string, env: FeatureFlagEnv = process.env) {
  return ["1", "true", "yes", "on"].includes(String(env[name] || "").trim().toLowerCase());
}

export function isInvestorFinalizationEnabled(env?: FeatureFlagEnv) {
  return isProductionFeatureEnabled(INVESTOR_FINALIZATION_FLAG, env);
}

export function isInvestorSettlementEnabled(env?: FeatureFlagEnv) {
  return isProductionFeatureEnabled(INVESTOR_SETTLEMENT_FLAG, env);
}

export function isInvestorFxSettlementEnabled(env?: FeatureFlagEnv) {
  return isProductionFeatureEnabled(INVESTOR_FX_SETTLEMENT_FLAG, env);
}
