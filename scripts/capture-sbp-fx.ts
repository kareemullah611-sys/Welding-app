import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { isSbpDailyRateCurrent, parseSbpUsdPkrDailyHtml, SBP_DAILY_SOURCE_URL } from "../src/lib/sbp-daily-fx";

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
    await page.goto(SBP_DAILY_SOURCE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(12_000);
    await page.getByText("Weighted Average Rate", { exact: false }).first().waitFor({ timeout: 30_000 });
    const fetchedAt = new Date();
    const html = await page.content();
    const parsed = parseSbpUsdPkrDailyHtml({ html, sourceUrl: SBP_DAILY_SOURCE_URL, fetchedAt });
    if (!isSbpDailyRateCurrent(parsed)) throw new Error(`SBP source rate for ${parsed.rateDate} is stale and will not be saved`);
    const htmlPath = path.join(outputDir, `sbp-usd-pkr-${parsed.rateDate}.html`);
    const screenshotPath = path.join(outputDir, `sbp-usd-pkr-${parsed.rateDate}.png`);
    await writeFile(htmlPath, html, "utf8");
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const formData = new FormData();
    formData.set("sourceUrl", SBP_DAILY_SOURCE_URL);
    formData.set("fetchedAt", fetchedAt.toISOString());
    formData.set("rawHtml", new Blob([html], { type: "text/html; charset=utf-8" }), path.basename(htmlPath));
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
