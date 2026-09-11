import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("sale create modal clears errors on edits and locks its fields while saving", () => {
  const page = read("src/app/(dashboard)/sales/page.tsx");

  assert.match(page, /<fieldset[\s\S]*disabled=\{submitting\}/);
  assert.match(page, /onChangeCapture=\{clearSaleCreateError\}/);
  assert.match(page, /onInputCapture=\{clearSaleCreateError\}/);
  assert.match(page, /setShortConfirmed\(false\)/);
});

test("payment create modal clears errors on edits and locks its fields while saving", () => {
  const page = read("src/app/(dashboard)/payments/page.tsx");

  assert.match(page, /<fieldset[\s\S]*disabled=\{submitting \|\| savingQueue\}/);
  assert.match(page, /onChangeCapture=\{clearPaymentCreateError\}/);
  assert.match(page, /onInputCapture=\{clearPaymentCreateError\}/);
});
