export type HistoricalLotRemediationRate = {
  countryCode: "PK" | "AF";
  lotNumber: string;
  recognitionDate: string;
  rawBuyRate: number | null;
  rawSellRate: number | null;
  adjustmentPkr: number;
  finalRate: number;
  source: "SBP_OPEN_MARKET_CLOSING" | "MANUAL_HISTORICAL_REMEDIATION";
  sourceReference: string;
};

export const HISTORICAL_LOT_REMEDIATION_RATES: readonly HistoricalLotRemediationRate[] = [
  { countryCode: "PK", lotNumber: "649", recognitionDate: "2025-10-08", rawBuyRate: 281.71, rawSellRate: 282.25, adjustmentPkr: 3, finalRate: 285.25, source: "SBP_OPEN_MARKET_CLOSING", sourceReference: "SBP open-market closing USD/PKR for 2025-10-08" },
  { countryCode: "PK", lotNumber: "865", recognitionDate: "2026-02-20", rawBuyRate: 280.04, rawSellRate: 280.62, adjustmentPkr: 3, finalRate: 283.62, source: "SBP_OPEN_MARKET_CLOSING", sourceReference: "SBP open-market closing USD/PKR for 2026-02-20" },
  { countryCode: "PK", lotNumber: "032", recognitionDate: "2026-03-04", rawBuyRate: 279.38, rawSellRate: 280.45, adjustmentPkr: 3, finalRate: 283.45, source: "SBP_OPEN_MARKET_CLOSING", sourceReference: "SBP open-market closing USD/PKR for 2026-03-04" },
  { countryCode: "PK", lotNumber: "108", recognitionDate: "2026-03-31", rawBuyRate: 279.48, rawSellRate: 280.22, adjustmentPkr: 3, finalRate: 283.22, source: "SBP_OPEN_MARKET_CLOSING", sourceReference: "SBP open-market closing USD/PKR for 2026-03-31" },
  { countryCode: "PK", lotNumber: "109", recognitionDate: "2026-04-28", rawBuyRate: 279.27, rawSellRate: 280.09, adjustmentPkr: 3, finalRate: 283.09, source: "SBP_OPEN_MARKET_CLOSING", sourceReference: "SBP open-market closing USD/PKR for 2026-04-28" },
  { countryCode: "PK", lotNumber: "194", recognitionDate: "2026-04-30", rawBuyRate: 279.23, rawSellRate: 280.05, adjustmentPkr: 3, finalRate: 283.05, source: "SBP_OPEN_MARKET_CLOSING", sourceReference: "SBP open-market closing USD/PKR for 2026-04-30" },
  { countryCode: "PK", lotNumber: "242", recognitionDate: "2026-05-05", rawBuyRate: 279.18, rawSellRate: 280.02, adjustmentPkr: 3, finalRate: 283.02, source: "SBP_OPEN_MARKET_CLOSING", sourceReference: "SBP open-market closing USD/PKR for 2026-05-05" },
  { countryCode: "PK", lotNumber: "225", recognitionDate: "2026-05-07", rawBuyRate: 279.18, rawSellRate: 279.98, adjustmentPkr: 3, finalRate: 282.98, source: "SBP_OPEN_MARKET_CLOSING", sourceReference: "SBP open-market closing USD/PKR for 2026-05-07" },
  { countryCode: "PK", lotNumber: "JBP306-26", recognitionDate: "2026-05-21", rawBuyRate: null, rawSellRate: null, adjustmentPkr: 0, finalRate: 281, source: "MANUAL_HISTORICAL_REMEDIATION", sourceReference: "User-approved historical exception" },
  { countryCode: "PK", lotNumber: "195", recognitionDate: "2026-05-22", rawBuyRate: null, rawSellRate: null, adjustmentPkr: 0, finalRate: 281, source: "MANUAL_HISTORICAL_REMEDIATION", sourceReference: "User-approved historical exception" },
  { countryCode: "PK", lotNumber: "JBP305-26", recognitionDate: "2026-06-12", rawBuyRate: null, rawSellRate: null, adjustmentPkr: 0, finalRate: 281, source: "MANUAL_HISTORICAL_REMEDIATION", sourceReference: "User-approved historical exception" },
  { countryCode: "PK", lotNumber: "124", recognitionDate: "2026-07-05", rawBuyRate: null, rawSellRate: null, adjustmentPkr: 0, finalRate: 281, source: "MANUAL_HISTORICAL_REMEDIATION", sourceReference: "User-approved historical exception" },
  { countryCode: "PK", lotNumber: "260", recognitionDate: "2026-07-05", rawBuyRate: null, rawSellRate: null, adjustmentPkr: 0, finalRate: 281, source: "MANUAL_HISTORICAL_REMEDIATION", sourceReference: "User-approved historical exception" },
  { countryCode: "AF", lotNumber: "JBP-013", recognitionDate: "2026-07-08", rawBuyRate: null, rawSellRate: null, adjustmentPkr: 0, finalRate: 288, source: "MANUAL_HISTORICAL_REMEDIATION", sourceReference: "User-approved historical exception" },
  { countryCode: "AF", lotNumber: "JBP-866", recognitionDate: "2026-07-08", rawBuyRate: null, rawSellRate: null, adjustmentPkr: 0, finalRate: 288, source: "MANUAL_HISTORICAL_REMEDIATION", sourceReference: "User-approved historical exception" },
  { countryCode: "AF", lotNumber: "JBP-112", recognitionDate: "2026-07-08", rawBuyRate: null, rawSellRate: null, adjustmentPkr: 0, finalRate: 288, source: "MANUAL_HISTORICAL_REMEDIATION", sourceReference: "User-approved historical exception" },
] as const;

export function getApprovedHistoricalLotRate(countryCode: string, lotNumber: string): HistoricalLotRemediationRate | null {
  const normalizedCountry = String(countryCode || "").trim().toUpperCase();
  const normalizedLot = String(lotNumber || "").trim().toUpperCase();
  return HISTORICAL_LOT_REMEDIATION_RATES.find((row) => (
    row.countryCode === normalizedCountry && row.lotNumber.toUpperCase() === normalizedLot
  )) || null;
}
