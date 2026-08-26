export const INVESTOR_SYSTEM_MODE_FLAG = "INVESTOR_SYSTEM_MODE";

export const INVESTOR_SYSTEM_MODES = {
  LEGACY: "LEGACY",
  MIGRATION_READY: "MIGRATION_READY",
  MIGRATED: "MIGRATED",
} as const;

export type InvestorSystemMode = typeof INVESTOR_SYSTEM_MODES[keyof typeof INVESTOR_SYSTEM_MODES];
type InvestorModeEnv = Record<string, string | undefined>;

export function getInvestorSystemMode(env: InvestorModeEnv = process.env): InvestorSystemMode {
  const configured = String(env[INVESTOR_SYSTEM_MODE_FLAG] || "").trim().toUpperCase();
  return configured === INVESTOR_SYSTEM_MODES.MIGRATION_READY || configured === INVESTOR_SYSTEM_MODES.MIGRATED
    ? configured
    : INVESTOR_SYSTEM_MODES.LEGACY;
}

export function legacyInvestorWritesAllowed(env?: InvestorModeEnv) {
  return getInvestorSystemMode(env) === INVESTOR_SYSTEM_MODES.LEGACY;
}
