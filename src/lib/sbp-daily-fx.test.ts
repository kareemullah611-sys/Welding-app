import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  isSbpDailyRateCurrent,
  parseSbpOpenMarketClosingText,
  parseSbpUsdPkrDailyHtml,
  SBP_DAILY_RATE_SOURCE,
  SBP_OPEN_MARKET_SOURCE_URL,
} from "./sbp-daily-fx";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("SBP daily parser preserves the official date and USD/PKR bid offer", () => {
  const parsed = parseSbpUsdPkrDailyHtml({
    html: `<html><body><h3>USD/ PKR Rates</h3><p>As on 03 Sep - 2026</p><h4>Weighted Average Rate</h4><p>BID</p><strong>279.8035</strong><p>Offer</p><strong>280.2286</strong></body></html>`,
    sourceUrl: "https://www.sbp.org.pk/ecodata/rates/war/WAR-Current.asp",
    fetchedAt: new Date("2026-09-03T07:30:00.000Z"),
  });

  assert.equal(parsed.rateDate, "2026-09-03");
  assert.equal(parsed.buyRate, 279.8035);
  assert.equal(parsed.sellRate, 280.2286);
  assert.equal(parsed.referenceRate, 280.2286);
  assert.equal(parsed.source, SBP_DAILY_RATE_SOURCE);
  assert.equal(isSbpDailyRateCurrent(parsed), true);
});

test("SBP parser reads the current official open-market closing PDF", () => {
  const parsed = parseSbpOpenMarketClosingText({
    text: `Exchange Companies Association of Pakistan (ECAP)\nOpen Market Closing Exchange Rates as on September 2 5 , 2026\nCurrency Buying Selling\nUSD 278.12 279.20\nEUR 316.43 319.49`,
    sourceUrl: "https://www.sbp.org.pk/assets/document/open-market-closing-exchange-rates-25-september-2026.pdf",
    fetchedAt: new Date("2026-09-25T13:30:00.000Z"),
    rawPayload: new TextEncoder().encode("official-sbp-pdf-bytes"),
  });

  assert.equal(SBP_OPEN_MARKET_SOURCE_URL, "https://www.sbp.org.pk/economic-data/open-market-closing-exchange-rates");
  assert.equal(parsed.rateDate, "2026-09-25");
  assert.equal(parsed.buyRate, 278.12);
  assert.equal(parsed.sellRate, 279.20);
  assert.equal(parsed.referenceRate, 279.20);
  assert.equal(parsed.source, "SBP_OPEN_MARKET_CLOSING_RATE");
  assert.equal(parsed.market, "open_market_closing");
  assert.notEqual(parsed.rawPayloadHash, "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  assert.equal(isSbpDailyRateCurrent(parsed), true);
});

test("SBP parser rejects non-official sources and missing rates", () => {
  assert.throws(() => parseSbpUsdPkrDailyHtml({
    html: "USD PKR 280",
    sourceUrl: "https://example.com/rates",
    fetchedAt: new Date(),
  }), /official SBP/);
});

test("SBP daily capture blocks stale published rates", () => {
  const parsed = parseSbpUsdPkrDailyHtml({
    html: `<p>As on 21 Aug - 2026</p><p>Weighted Average Rate BID 277.1767 Offer 277.6018</p>`,
    sourceUrl: "https://www.sbp.org.pk/ecodata/rates/war/WAR-Current.asp",
    fetchedAt: new Date("2026-09-03T07:30:00.000Z"),
  });

  assert.equal(parsed.sourceAgeDays, 13);
  assert.equal(isSbpDailyRateCurrent(parsed), false);
});

test("daily FX workflow captures both sources and retains evidence for seven days", () => {
  const workflow = read(".github/workflows/sarafi-af-assisted-capture.yml");
  const sbpCapture = read("scripts/capture-sbp-fx.ts");
  const schema = read("prisma/schema.prisma");
  const bucket = read("src/lib/railway-bucket.ts");

  assert.match(workflow, /fx:sbp:capture/);
  assert.match(workflow, /SARAFI_AF_CAPTURE_ENDPOINT/);
  assert.match(workflow, /SARAFI_AF_CAPTURE_TOKEN/);
  assert.match(workflow, /FX_EVIDENCE_CLEANUP_ENDPOINT/);
  assert.match(workflow, /retention-days: 7/);
  assert.match(schema, /model SbpDailyFxSnapshot/);
  assert.match(schema, /evidenceExpiresAt\s+DateTime/);
  assert.match(schema, /evidenceDeletedAt\s+DateTime\?/);
  assert.match(bucket, /DeleteObjectCommand/);
  assert.match(sbpCapture, /deriveSbpCaptureEndpoint/);
});

test("SBP snapshots use an accurate source name and never overwrite an existing daily rate", () => {
  const db = read("src/lib/sbp-daily-fx-db.ts");
  const provider = read("src/lib/sbp-daily-fx.ts");

  assert.match(provider, /SBP_OPEN_MARKET_CLOSING_RATE/);
  assert.match(db, /source: input\.source/);
  assert.match(db, /market: input\.market/);
  assert.match(db, /exchangeRate\.findUnique/);
  assert.doesNotMatch(db, /exchangeRate\.upsert/);
  assert.doesNotMatch(db, /exchangeRate\.update/);
});

test("expired evidence cleanup removes files but preserves rate rows", () => {
  const cleanup = read("src/lib/fx-evidence-retention.ts");

  assert.match(cleanup, /deleteBucketObject/);
  assert.match(cleanup, /evidenceDeletedAt/);
  assert.doesNotMatch(cleanup, /exchangeRate\.delete/);
  assert.doesNotMatch(cleanup, /sarafiAfFxSnapshot\.delete/);
});
