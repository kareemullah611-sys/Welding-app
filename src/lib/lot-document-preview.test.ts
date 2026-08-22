import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("saved lot documents open in an in-app preview modal", () => {
  const source = readFileSync(resolve(process.cwd(), "src/components/lots/LotDetailTabs.tsx"), "utf8");

  assert.doesNotMatch(source, /href=\{doc\.downloadUrl\}\s+target="_blank"/);
  assert.match(source, /setPreviewDocument\(doc\)/);
  assert.match(source, /<Modal[\s\S]*open=\{!!previewDocument\}/);
  assert.match(source, /title=\{previewDocument\?\.originalFileName/);
  assert.match(source, /<iframe[\s\S]*src=\{`\$\{previewDocument\?\.downloadUrl\}\?preview=1`\}/);
  assert.match(source, /downloadDocument\(previewDocument\)/);
});

test("document previews are streamed through the authenticated same-origin route", () => {
  const source = readFileSync(resolve(process.cwd(), "src/app/api/v1/lots/[id]/documents/[documentId]/download/route.ts"), "utf8");

  assert.match(source, /searchParams\.get\("preview"\) === "1"/);
  assert.match(source, /await fetch\(url/);
  assert.match(source, /Content-Disposition/);
  assert.match(source, /inline; filename=/);
});
