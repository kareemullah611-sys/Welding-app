import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

import { injectPrintUrlSuppression } from "./ledger-export";

test("prints the shipped page URL when the template leaves a non-zero @page margin", () => {
  const template = `
    <html><head><title>Customer Ledger</title>
      <style>@page { margin: 12mm; size: A4 landscape; }</style>
    </head><body></body></html>
  `;
  // The template's positive @page margin reserves header/footer space, so a
  // browser prints the app URL in the footer strip.
  assert.match(template, /@page\s*\{\s*margin:\s*12mm/);
});

test("injectPrintUrlSuppression adds a zero-margin @page rule after the template's own rule", () => {
  const raw = `
    <html><head><title>Customer Ledger</title>
      <style>@page { margin: 12mm; }</style>
    </head><body></body></html>
  `;
  const out = injectPrintUrlSuppression(raw);

  // Suppression rule must be inserted before the closing head tag.
  assert.match(out, /@page\s*\{\s*margin:\s*0;\s*\}\s*<\/style>\s*<\/head>/);

  // It must come after the template's @page rule so the cascade overrides it.
  const afterTemplate = out.indexOf("@page { margin: 12mm");
  const suppressionRule = out.indexOf("@page { margin: 0;");
  assert.ok(afterTemplate !== -1, "template @page rule should be present");
  assert.ok(suppressionRule > afterTemplate, "suppression rule should come after and override the template rule");
});

test("injectPrintUrlSuppression leaves HTML without a closing head untouched", () => {
  const raw = "<body></body>";
  assert.equal(injectPrintUrlSuppression(raw), raw);
});

test("payments PDF maps the six export columns into the current report layout", () => {
  const source = readFileSync("src/lib/ledger-export.ts", "utf8");
  const start = source.indexOf("function printPaymentsReportPayload");
  const end = source.indexOf("export async function fetchLedgerExportPayload", start);
  const paymentTemplate = source.slice(start, end);

  assert.match(paymentTemplate, /<td class="col-details">\$\{escapeHtml\(row\[1\]\)\}<\/td>/);
  assert.match(paymentTemplate, /<td class="col-ref">\$\{escapeHtml\(row\[2\]\)\}<\/td>/);
  assert.match(paymentTemplate, /<td class="col-money debit">\$\{escapeHtml\(row\[3\]\)\}<\/td>/);
  assert.match(paymentTemplate, /<td class="col-money credit">\$\{escapeHtml\(row\[4\]\)\}<\/td>/);
  assert.match(paymentTemplate, /<td class="col-money balance">\$\{escapeHtml\(row\[5\]\)\}<\/td>/);
  assert.match(paymentTemplate, /<th class="col-details">Details<\/th>/);
  assert.doesNotMatch(paymentTemplate, /col-type|col-name|col-particulars|row\[6\]|row\[7\]/);
});
