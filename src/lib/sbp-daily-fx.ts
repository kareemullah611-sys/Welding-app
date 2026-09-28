import { createHash, timingSafeEqual } from "node:crypto";

export const SBP_DAILY_RATE_SOURCE = "SBP_WEIGHTED_AVERAGE_CUSTOMER_RATE";
export const SBP_DAILY_MARKET = "weighted_average_customer";
export const SBP_DAILY_SOURCE_URL = "https://www.sbp.org.pk/ecodata/rates/war/WAR-Current.asp";
export const SBP_OPEN_MARKET_RATE_SOURCE = "SBP_OPEN_MARKET_CLOSING_RATE";
export const SBP_OPEN_MARKET = "open_market_closing";
export const SBP_OPEN_MARKET_SOURCE_URL = "https://www.sbp.org.pk/economic-data/open-market-closing-exchange-rates";
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

export function parseSbpOpenMarketClosingText(input: { text: string; sourceUrl: string; fetchedAt: Date; rawPayload?: Uint8Array }) {
  const source = new URL(input.sourceUrl);
  if (source.protocol !== "https:" || !["sbp.org.pk", "www.sbp.org.pk"].includes(source.hostname.toLowerCase())) {
    throw new Error("An official SBP HTTPS source is required");
  }
  if (!Number.isFinite(input.fetchedAt.getTime())) throw new Error("Invalid SBP fetch timestamp");
  const normalized = input.text.replace(/\s+/g, " ").trim();
  if (!/Open Market Closing Exchange Rates/i.test(normalized)) throw new Error("SBP open-market closing rate heading was not found");
  const dateMatch = normalized.match(/as\s+on\s+([A-Za-z]+)\s+(\d(?:\s*\d)?)\s*,\s*(\d{4})/i);
  if (!dateMatch) throw new Error("SBP open-market closing date was not found");
  const month = MONTHS[dateMatch[1].slice(0, 3).toLowerCase()];
  if (!month) throw new Error("SBP open-market closing month is invalid");
  const day = dateMatch[2].replace(/\s+/g, "").padStart(2, "0");
  const rateDate = `${dateMatch[3]}-${month}-${day}`;
  const usdMatch = normalized.match(/(?:^|\s)USD\s+([0-9]+(?:\.[0-9]+)?)\s+([0-9]+(?:\.[0-9]+)?)(?:\s|$)/i);
  if (!usdMatch) throw new Error("SBP open-market USD buying and selling rates were not found");
  const buyRate = Number(usdMatch[1]);
  const sellRate = Number(usdMatch[2]);
  if (!(buyRate > 0) || !(sellRate > 0) || sellRate < buyRate) throw new Error("SBP open-market USD rates failed validation");
  const sourceAgeDays = Math.floor((input.fetchedAt.getTime() - new Date(`${rateDate}T00:00:00.000Z`).getTime()) / (24 * 60 * 60 * 1000));
  const hashInput = input.rawPayload ? Buffer.from(input.rawPayload) : input.text;

  return {
    rateDate,
    fromCurrencyCode: "USD" as const,
    toCurrencyCode: "PKR" as const,
    buyRate,
    sellRate,
    referenceRate: sellRate,
    source: SBP_OPEN_MARKET_RATE_SOURCE,
    market: SBP_OPEN_MARKET,
    sourceUrl: input.sourceUrl,
    fetchedAt: input.fetchedAt.toISOString(),
    rawPayloadHash: createHash("sha256").update(hashInput).digest("hex"),
    sourceAgeDays,
  };
}

export async function extractPdfText(data: Uint8Array) {
  // @ts-expect-error pdfjs-dist does not publish declarations for its worker entry.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await getDocument({ data: data.slice() }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map((item: any) => item.str || "").join(" "));
  }
  return pages.join("\n");
}

export function isSbpDailyRateCurrent(rate: { sourceAgeDays: number }) {
  return rate.sourceAgeDays >= 0 && rate.sourceAgeDays <= SBP_MAX_SOURCE_AGE_DAYS;
}
