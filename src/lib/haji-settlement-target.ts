export function buildSettlementTargetValue(
  settlementDestination?: string | null,
  intermediaryId?: number | null,
  superAdminCashAccountId?: number | null,
): string {
  if (settlementDestination === "super_admin_cash" && superAdminCashAccountId) {
    return `cash:${superAdminCashAccountId}`;
  }
  if (intermediaryId) {
    return `intermediary:${intermediaryId}`;
  }
  return "";
}

export function parseSettlementTargetValue(value: string): {
  settlementDestination: "intermediary" | "super_admin_cash";
  intermediaryId: number;
  superAdminCashAccountId: number;
} {
  const [kind, idRaw] = String(value || "").split(":");
  const id = parseInt(idRaw || "0", 10) || 0;
  if (kind === "cash" && id > 0) {
    return { settlementDestination: "super_admin_cash", intermediaryId: 0, superAdminCashAccountId: id };
  }
  if (kind === "intermediary" && id > 0) {
    return { settlementDestination: "intermediary", intermediaryId: id, superAdminCashAccountId: 0 };
  }
  return { settlementDestination: "intermediary", intermediaryId: 0, superAdminCashAccountId: 0 };
}

export function isSettlementTargetSelected(value: string): boolean {
  const parsed = parseSettlementTargetValue(value);
  return parsed.intermediaryId > 0 || parsed.superAdminCashAccountId > 0;
}
