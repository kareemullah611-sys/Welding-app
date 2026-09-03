import { createHash, timingSafeEqual } from "node:crypto";

export const SBP_DAILY_RATE_SOURCE = "SBP_WEIGHTED_AVERAGE_CUSTOMER_RATE";
export const SBP_DAILY_MARKET = "weighted_average_customer";
export const SBP_DAILY_SOURCE_URL = "https://www.sbp.org.pk/ecodata/rates/war/WAR-Current.asp";
export const SBP_MAX_SOURCE_AGE_DAYS = 4;

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

function textFromHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function isValidDailyFxCaptureToken(token: string | null, env: Record<string, string | undefined> = process.env) {
  const expected = String(env.DAILY_FX_CAPTURE_TOKEN || env.SARAFI_AF_CAPTURE_TOKEN || "");
  if (expected.length < 32 || !token || token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

export function parseSbpUsdPkrDailyHtml(input: { html: string; sourceUrl: string; fetchedAt: Date }) {
  const source = new URL(input.sourceUrl);
  if (source.protocol !== "https:" || !["sbp.org.pk", "www.sbp.org.pk"].includes(source.hostname.toLowerCase())) {
    throw new Error("An official SBP HTTPS source is required");
  }
  if (!Number.isFinite(input.fetchedAt.getTime())) throw new Error("Invalid SBP fetch timestamp");

  const text = textFromHtml(input.html);
  const dateMatch = text.match(/As\s+on\s+(\d{1,2})\s*[- ]\s*([A-Za-z]{3,9})\s*[- ]\s*(\d{2,4})/i);
  if (!dateMatch) throw new Error("SBP quoted market date was not found");
  const month = MONTHS[dateMatch[2].slice(0, 3).toLowerCase()];
  if (!month) throw new Error("SBP quoted market month is invalid");
  const year = dateMatch[3].length === 2 ? `20${dateMatch[3]}` : dateMatch[3];
  const rateDate = `${year}-${month}-${dateMatch[1].padStart(2, "0")}`;
  const sourceAgeDays = Math.floor((input.fetchedAt.getTime() - new Date(`${rateDate}T00:00:00.000Z`).getTime()) / (24 * 60 * 60 * 1000));

  const ratesMatch = text.match(/Weighted\s+Average\s+Rate[\s\S]*?BID\s+([0-9]+(?:\.[0-9]+)?)[\s\S]*?(?:OFFER|Offer)\s+([0-9]+(?:\.[0-9]+)?)/i);
  if (!ratesMatch) throw new Error("SBP USD/PKR weighted-average bid and offer were not found");
  const buyRate = Number(ratesMatch[1]);
  const sellRate = Number(ratesMatch[2]);
  if (!(buyRate > 0) || !(sellRate > 0) || sellRate < buyRate) throw new Error("SBP USD/PKR rates failed validation");

  return {
    rateDate,
    fromCurrencyCode: "USD" as const,
    toCurrencyCode: "PKR" as const,
    buyRate,
    sellRate,
    referenceRate: sellRate,
    source: SBP_DAILY_RATE_SOURCE,
    market: SBP_DAILY_MARKET,
    sourceUrl: input.sourceUrl,
    fetchedAt: input.fetchedAt.toISOString(),
    rawPayloadHash: createHash("sha256").update(input.html).digest("hex"),
    sourceAgeDays,
  };
}

export function isSbpDailyRateCurrent(rate: { sourceAgeDays: number }) {
  return rate.sourceAgeDays >= 0 && rate.sourceAgeDays <= SBP_MAX_SOURCE_AGE_DAYS;
}
