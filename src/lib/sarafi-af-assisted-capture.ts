import { createHash, timingSafeEqual } from "node:crypto";
import { SARAFI_AF_MARKET, SARAFI_AF_TIMEZONE, type SarafiAfQuoteInput } from "./sarafi-af-snapshot";

export const SARAFI_AF_ASSISTED_CAPTURE_FLAG = "SARAFI_AF_ASSISTED_CAPTURE_ENABLED";
export const SARAFI_AF_ASSISTED_SOURCE_URL = "https://sarafi.af/en/exchange-rates/sarai-shahzada";

export type SarafiAfAssistedCaptureQuote = SarafiAfQuoteInput & {
  sourceTime: string;
};

export type ParsedSarafiAfAssistedCapture = {
  snapshotDate: string;
  timezone: typeof SARAFI_AF_TIMEZONE;
  provider: "SARAFI_AF";
  market: typeof SARAFI_AF_MARKET;
  sourceUrl: string;
  fetchedAt: string;
  sourceTimestamp: string;
  rawPayloadHash: string;
  quotes: SarafiAfAssistedCaptureQuote[];
};

const REQUIRED_QUOTES = ["USD", "PKR", "CNY", "AED"] as const;
const KABUL_OFFSET_MINUTES = 4 * 60 + 30;

function textContent(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
}

function readCell(row: string, className: string) {
  const expression = new RegExp(`class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/`, "i");
  const match = row.match(expression);
  return match ? textContent(match[1]) : "";
}

function positiveNumber(value: string, label: string) {
  const parsed = Number(value.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be greater than zero`);
  return parsed;
}

function kabulDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SARAFI_AF_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((entry) => entry.type === type)?.value || 0);
  return { year: part("year"), month: part("month"), day: part("day") };
}

function sourceTimeOnCaptureDay(sourceTime: string, fetchedAt: Date) {
  const match = sourceTime.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) throw new Error(`Invalid Sarafi.af source time: ${sourceTime || "missing"}`);
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  const minute = Number(match[2]);
  const { year, month, day } = kabulDateParts(fetchedAt);
  let timestamp = Date.UTC(year, month - 1, day, hour, minute) - KABUL_OFFSET_MINUTES * 60_000;
  if (timestamp > fetchedAt.getTime() + 5 * 60_000) timestamp -= 86_400_000;
  return new Date(timestamp);
}

function assertOfficialSaraiShahzadaSource(sourceUrl: string, html: string) {
  const parsed = new URL(sourceUrl);
  const officialHost = parsed.hostname === "sarafi.af" || parsed.hostname === "www.sarafi.af";
  const officialPath = /^\/(?:en\/)?exchange-rates\/sarai-shahzada\/?$/i.test(parsed.pathname);
  if (!officialHost || !officialPath || !/Sarai Shahzada/i.test(html)) {
    throw new Error("Assisted capture requires the official Sarai Shahzada market page");
  }
}

export function isSarafiAfAssistedCaptureEnabled(env: Record<string, string | undefined> = process.env) {
  return ["1", "true", "yes", "on"].includes(String(env[SARAFI_AF_ASSISTED_CAPTURE_FLAG] || "").trim().toLowerCase());
}

export function isValidSarafiAfCaptureToken(
  requestToken: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
) {
  const expected = String(env.SARAFI_AF_CAPTURE_TOKEN || "");
  const received = String(requestToken || "");
  if (expected.length < 32 || received.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(received, "utf8"), Buffer.from(expected, "utf8"));
}

export function parseSarafiAfSaraiShahzadaHtml(input: {
  html: string;
  sourceUrl: string;
  fetchedAt: Date;
}): ParsedSarafiAfAssistedCapture {
  assertOfficialSaraiShahzadaSource(input.sourceUrl, input.html);
  const rows = input.html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || [];

  const quotes = REQUIRED_QUOTES.map((currencyCode) => {
    const pairPath = `/exchange-rates/sarai-shahzada/${currencyCode}-AFN`;
    const row = rows.find((candidate) => candidate.includes(pairPath));
    if (!row) throw new Error(`Missing ${currencyCode}/AFN Sarai Shahzada quote`);
    const sourceTime = readCell(row, "time");
    sourceTimeOnCaptureDay(sourceTime, input.fetchedAt);
    return {
      baseCurrencyCode: currencyCode,
      quoteCurrencyCode: "AFN",
      rawBuyRate: positiveNumber(readCell(row, "buyRate"), `${currencyCode}/AFN buy rate`),
      rawSellRate: positiveNumber(readCell(row, "sellRate"), `${currencyCode}/AFN sell rate`),
      rawUnit: currencyCode === "PKR" ? "1K" : "1",
      sourceTime,
    };
  });

  const captureDate = kabulDateParts(input.fetchedAt);
  const snapshotDate = `${captureDate.year}-${String(captureDate.month).padStart(2, "0")}-${String(captureDate.day).padStart(2, "0")}`;

  return {
    snapshotDate,
    timezone: SARAFI_AF_TIMEZONE,
    provider: "SARAFI_AF",
    market: SARAFI_AF_MARKET,
    sourceUrl: input.sourceUrl,
    fetchedAt: input.fetchedAt.toISOString(),
    sourceTimestamp: input.fetchedAt.toISOString(),
    rawPayloadHash: createHash("sha256").update(input.html).digest("hex"),
    quotes,
  };
}
