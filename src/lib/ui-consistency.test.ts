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

test("dark mode replaces light hover highlights across shared controls", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  assert.match(css, /\.dark \[class\*="hover:bg-gray-50"\]:hover[\s\S]*background-color: #2a2023 !important/);
  assert.match(css, /\.dark \[class\*="hover:bg-gray-100"\]:hover[\s\S]*background-color: #382a2f !important/);
  assert.match(css, /\.dark \[class\*="hover:bg-white\/35"\]:hover[\s\S]*background-color: rgba\(56, 42, 47, 0\.88\) !important/);
  assert.match(css, /\.dark \[class\*="hover:bg-green-50"\]:hover[\s\S]*background-color: rgba\(22, 101, 52, 0\.38\) !important/);
  assert.match(css, /\.dark \[class\*="hover:bg-emerald-100"\]:hover[\s\S]*background-color: rgba\(22, 101, 52, 0\.46\) !important/);
  assert.match(css, /\.dark \[class\*="hover:bg-red-50"\]:hover[\s\S]*background-color: rgba\(153, 27, 27, 0\.4\) !important/);
  assert.match(css, /\.dark \[class\*="hover:text-gray-700"\]:hover[\s\S]*color: #eee4e1 !important/);
});

test("dark mode keeps expanded panels and sidebar branding visible", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

  assert.match(css, /\.dark \[class\*="bg-gray-50\/"\][\s\S]*background-color: #2a2023 !important/);
  assert.match(sidebar, /pointer-events-none absolute inset-x-0 top-0 z-10 h-28[^\n]*dark:hidden/);
});

test("lot creation highlights the calculated carton count", () => {
  const lots = readFileSync("src/app/(dashboard)/lots/page.tsx", "utf8");

  assert.match(lots, /lot-carton-count-highlight/);
  assert.match(lots, /cartons \(calculated\)/);
});
