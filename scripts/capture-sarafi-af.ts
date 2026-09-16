import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import {
  parseSarafiAfSaraiShahzadaHtml,
  SARAFI_AF_ASSISTED_SOURCE_URL,
} from "../src/lib/sarafi-af-assisted-capture";

async function main() {
  const captureEndpoint = String(process.env.SARAFI_AF_CAPTURE_ENDPOINT || "").trim();
  const captureToken = String(process.env.SARAFI_AF_CAPTURE_TOKEN || "");
  if (!/^https:\/\//i.test(captureEndpoint)) throw new Error("SARAFI_AF_CAPTURE_ENDPOINT must be an HTTPS URL");
  if (captureToken.length < 32) throw new Error("SARAFI_AF_CAPTURE_TOKEN must contain at least 32 characters");

  const outputDir = path.resolve(".artifacts", "sarafi-af");
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(SARAFI_AF_ASSISTED_SOURCE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator('a[href="/exchange-rates/sarai-shahzada/USD-AFN"]').first().waitFor({ timeout: 30_000 });
    const fetchedAt = new Date();
    const html = await page.content();
    const parsed = parseSarafiAfSaraiShahzadaHtml({
      html,
      sourceUrl: SARAFI_AF_ASSISTED_SOURCE_URL,
      fetchedAt,
    });
    const htmlPath = path.join(outputDir, `sarafi-af-${parsed.snapshotDate}.html`);
    const screenshotPath = path.join(outputDir, `sarafi-af-${parsed.snapshotDate}.png`);
    await writeFile(htmlPath, html, "utf8");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const screenshot = await import("node:fs/promises").then((fs) => fs.readFile(screenshotPath));

    const formData = new FormData();
    formData.set("sourceUrl", SARAFI_AF_ASSISTED_SOURCE_URL);
    formData.set("fetchedAt", fetchedAt.toISOString());
    formData.set("rawHtml", new Blob([html], { type: "text/html; charset=utf-8" }), path.basename(htmlPath));
    formData.set("screenshot", new Blob([screenshot], { type: "image/png" }), path.basename(screenshotPath));
    const response = await fetch(captureEndpoint, {
      method: "POST",
      headers: { "x-sarafi-capture-token": captureToken },
      body: formData,
    });
    const responseBody = await response.text();
    if (!response.ok) throw new Error(`Capture upload failed (${response.status}): ${responseBody.slice(0, 500)}`);
    console.log(JSON.stringify({
      status: "authorized",
      snapshotDate: parsed.snapshotDate,
      market: parsed.market,
      sourceTimestamp: parsed.sourceTimestamp,
      quotePairs: parsed.quotes.map((quote) => `${quote.baseCurrencyCode}/${quote.quoteCurrencyCode}`),
    }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
