import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { extractPdfText, isSbpDailyRateCurrent, parseSbpOpenMarketClosingText, SBP_OPEN_MARKET_SOURCE_URL } from "../src/lib/sbp-daily-fx";

function deriveSbpCaptureEndpoint() {
  const explicit = String(process.env.SBP_FX_CAPTURE_ENDPOINT || "").trim();
  if (explicit) return explicit;
  return String(process.env.SARAFI_AF_CAPTURE_ENDPOINT || "").trim()
    .replace(/\/sarafi-af\/captures\/?$/i, "/sbp");
}

async function main() {
  const endpoint = deriveSbpCaptureEndpoint();
  const token = String(process.env.DAILY_FX_CAPTURE_TOKEN || process.env.SARAFI_AF_CAPTURE_TOKEN || "");
  if (!/^https:\/\//i.test(endpoint)) throw new Error("SBP capture endpoint must be an HTTPS URL");
  if (token.length < 32) throw new Error("DAILY_FX_CAPTURE_TOKEN must contain at least 32 characters");

  const outputDir = path.resolve(".artifacts", "sbp-fx");
  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--disable-blink-features=AutomationControlled"] });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1200 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      locale: "en-US",
      timezoneId: "Asia/Karachi",
    });
    await page.goto(SBP_OPEN_MARKET_SOURCE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(12_000);
    const latestPdfLink = page.locator('#lawList a[href$=".pdf"]').first();
    await latestPdfLink.waitFor({ timeout: 30_000 });
    const sourceUrl = await latestPdfLink.getAttribute("href");
    if (!sourceUrl) throw new Error("Latest SBP open-market closing PDF link was not found");
    const pdfResponse = await page.request.get(sourceUrl, { timeout: 60_000 });
    if (!pdfResponse.ok()) throw new Error(`SBP PDF download failed (${pdfResponse.status()})`);
    const pdfBuffer = await pdfResponse.body();
    const fetchedAt = new Date();
    const text = await extractPdfText(new Uint8Array(pdfBuffer));
    const parsed = parseSbpOpenMarketClosingText({ text, sourceUrl, fetchedAt, rawPayload: new Uint8Array(pdfBuffer) });
    if (!isSbpDailyRateCurrent(parsed)) throw new Error(`SBP source rate for ${parsed.rateDate} is stale and will not be saved`);
    const pdfPath = path.join(outputDir, `sbp-usd-pkr-${parsed.rateDate}.pdf`);
    const screenshotPath = path.join(outputDir, `sbp-usd-pkr-${parsed.rateDate}.png`);
    await writeFile(pdfPath, pdfBuffer);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const formData = new FormData();
    formData.set("sourceUrl", sourceUrl);
    formData.set("fetchedAt", fetchedAt.toISOString());
    formData.set("rawPdf", new Blob([await readFile(pdfPath)], { type: "application/pdf" }), path.basename(pdfPath));
    formData.set("screenshot", new Blob([await readFile(screenshotPath)], { type: "image/png" }), path.basename(screenshotPath));
    const response = await fetch(endpoint, { method: "POST", headers: { "x-daily-fx-capture-token": token }, body: formData });
    const responseBody = await response.text();
    if (!response.ok) throw new Error(`SBP capture upload failed (${response.status}): ${responseBody.slice(0, 500)}`);
    console.log(JSON.stringify({ status: "saved", rateDate: parsed.rateDate, buyRate: parsed.buyRate, sellRate: parsed.sellRate, source: parsed.source }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
