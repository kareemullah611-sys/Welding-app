import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("shared export buttons retain readable dark-mode colors", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  assert.match(css, /\.dark \.glass-btn-xlsx[\s\S]*color:/);
  assert.match(css, /\.dark \.glass-btn-pdf[\s\S]*color:/);
});

test("sales and payments toolbars wrap exports below controls on narrow screens", () => {
  const sales = readFileSync("src/app/(dashboard)/sales/page.tsx", "utf8");
  const payments = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");

  for (const page of [sales, payments]) {
    assert.match(page, /mb-3 flex min-w-0 flex-wrap items-center gap-2/);
    assert.match(page, /className="w-full min-w-0 justify-end sm:ml-auto sm:w-auto"/);
  }
});

test("assistant and activity feed use dark surfaces behind dark-mode text", () => {
  const assistant = readFileSync("src/app/(dashboard)/assistant/page.tsx", "utf8");
  const activityFeed = readFileSync("src/app/(dashboard)/activity-feed/page.tsx", "utf8");

  assert.match(assistant, /assistant-chat-area[^\n]*dark:bg-\[#241d1f\]/);
  assert.match(activityFeed, /dark:bg-\[#21191c\][^\n]*dark:border-\[#4a363c\]/);
});
