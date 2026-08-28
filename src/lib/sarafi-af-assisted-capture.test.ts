import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSarafiAfSaraiShahzadaHtml,
  SARAFI_AF_ASSISTED_SOURCE_URL,
  isValidSarafiAfCaptureToken,
} from "./sarafi-af-assisted-capture";

const MARKET_HTML = `
  <h1>Sarai Shahzada</h1>
  <table class="exchangeRatesTable">
    <tr>
      <td><a href="/exchange-rates/sarai-shahzada/USD-AFN">USD - US Dollar</a></td>
      <td><b class="buyRate">68.40</b></td>
      <td><b class="sellRate">68.45</b></td>
      <td class="time">08:20 AM</td>
    </tr>
    <tr>
      <td><a href="/exchange-rates/sarai-shahzada/PKR-AFN">PKR - Pakistani Rupee <sup>1K</sup></a></td>
      <td><b class="buyRate">242</b></td>
      <td><b class="sellRate">243</b></td>
      <td class="time">08:10 AM</td>
    </tr>
    <tr>
      <td><a href="/exchange-rates/sarai-shahzada/CNY-AFN">CNY - Chinese Yuan</a></td>
      <td><b class="buyRate">9.45</b></td>
      <td><b class="sellRate">9.50</b></td>
      <td class="time">08:15 AM</td>
    </tr>
  </table>
`;

test("assisted capture extracts only required Sarai Shahzada quotes with PKR 1K evidence", () => {
  const result = parseSarafiAfSaraiShahzadaHtml({
    html: MARKET_HTML,
    sourceUrl: SARAFI_AF_ASSISTED_SOURCE_URL,
    fetchedAt: new Date("2026-08-28T04:00:00.000Z"),
  });

  assert.equal(result.market, "sarai_shahzada");
  assert.equal(result.snapshotDate, "2026-08-28");
  assert.equal(result.sourceTimestamp, "2026-08-28T03:40:00.000Z");
  assert.deepEqual(result.quotes.map((quote) => quote.baseCurrencyCode), ["USD", "PKR", "CNY"]);
  assert.equal(result.quotes.find((quote) => quote.baseCurrencyCode === "PKR")?.rawUnit, "1K");
  assert.match(result.rawPayloadHash, /^[a-f0-9]{64}$/);
});

test("assisted capture treats a source clock later than capture time as the previous Kabul day", () => {
  const html = MARKET_HTML.replace("08:10 AM", "04:30 PM");
  const result = parseSarafiAfSaraiShahzadaHtml({
    html,
    sourceUrl: SARAFI_AF_ASSISTED_SOURCE_URL,
    fetchedAt: new Date("2026-08-28T04:00:00.000Z"),
  });

  assert.equal(result.sourceTimestamp, "2026-08-27T12:00:00.000Z");
});

test("assisted capture blocks wrong market pages and incomplete required quotes", () => {
  assert.throws(() => parseSarafiAfSaraiShahzadaHtml({
    html: MARKET_HTML.replaceAll("sarai-shahzada", "khorasan-market"),
    sourceUrl: "https://sarafi.af/en/exchange-rates/khorasan-market",
    fetchedAt: new Date("2026-08-28T04:00:00.000Z"),
  }), /official Sarai Shahzada/);

  assert.throws(() => parseSarafiAfSaraiShahzadaHtml({
    html: MARKET_HTML.replace("/exchange-rates/sarai-shahzada/CNY-AFN", "/missing/CNY-AFN"),
    sourceUrl: SARAFI_AF_ASSISTED_SOURCE_URL,
    fetchedAt: new Date("2026-08-28T04:00:00.000Z"),
  }), /Missing CNY\/AFN/);
});

test("assisted capture requires a configured constant-time service token", () => {
  const token = "a".repeat(40);
  assert.equal(isValidSarafiAfCaptureToken(token, { SARAFI_AF_CAPTURE_TOKEN: token }), true);
  assert.equal(isValidSarafiAfCaptureToken("wrong", { SARAFI_AF_CAPTURE_TOKEN: token }), false);
  assert.equal(isValidSarafiAfCaptureToken("short", { SARAFI_AF_CAPTURE_TOKEN: "short" }), false);
});
