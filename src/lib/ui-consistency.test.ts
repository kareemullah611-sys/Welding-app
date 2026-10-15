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

test("interactive shell chrome clears the iOS notch and home indicator", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

  // The app renders with viewport-fit=cover, so fixed chrome must add its own
  // inset. max() keeps the desktop spacing as the floor on platforms with no inset.
  assert.match(css, /\.safe-top\s*\{\s*top:\s*max\(1rem, env\(safe-area-inset-top\)\);/);
  assert.match(css, /\.safe-left\s*\{\s*left:\s*max\(0\.75rem, env\(safe-area-inset-left\)\);/);
  assert.match(css, /\.safe-right\s*\{\s*right:\s*max\(0\.75rem, env\(safe-area-inset-right\)\);/);

  // The hamburger sat at a raw top-4/left-3, which renders under the Dynamic
  // Island and makes the menu unreachable on iOS.
  assert.match(sidebar, /lg:hidden fixed safe-top z-50/);
  assert.match(sidebar, /isRTL \? "safe-right" : "safe-left"/);
  assert.doesNotMatch(sidebar, /lg:hidden fixed top-4 z-50/);
});

test("fixed toast stacks clear the home indicator and side insets", () => {
  const banner = readFileSync("src/components/layout/OfflineBanner.tsx", "utf8");
  const payments = readFileSync("src/app/(dashboard)/payments/page.tsx", "utf8");

  // The banner's bottom-most child is the dismiss button and "Sync now", which
  // sit directly on bottom: 1rem — inside the 34px home-indicator gesture band.
  assert.match(banner, /fixed safe-bottom safe-right z-40/);
  assert.doesNotMatch(banner, /fixed bottom-4 right-4 z-40/);

  assert.match(payments, /fixed bottom-\[max\(1\.5rem,env\(safe-area-inset-bottom\)\)\] right-\[max\(1\.5rem,env\(safe-area-inset-right\)\)\]/);
  assert.doesNotMatch(payments, /fixed bottom-6 right-6/);
});

test("the mobile drawer clears the notch so its close control stays reachable", () => {
  const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

  // The drawer spans top-0, so its own content must add the inset. Without this
  // the close button sat at 12px — inside the 44-59px status bar band.
  assert.match(sidebar, /relative flex h-full flex-col pt-\[env\(safe-area-inset-top\)\]/);
  assert.match(sidebar, /absolute top-\[max\(0\.75rem,env\(safe-area-inset-top\)\)\] z-20/);
});

test("toast notifications have a mounted Toaster", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const openings = readFileSync("src/app/(dashboard)/openings/page.tsx", "utf8");

  // 59 toast.* calls were inert because <Toaster /> was never mounted.
  assert.match(openings, /import toast from "react-hot-toast"/);
  assert.match(layout, /import \{ Toaster \} from "react-hot-toast"/);
  assert.match(layout, /<Toaster\b/);
  assert.match(layout, /safe-area-inset-top/, "top-centred toasts must clear the notch");
});

test("sub-44px controls expose a 44px hit area without changing their size", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  // ::after expansion keeps the painted icon small so no layout shifts.
  assert.match(css, /\.tap-target::after\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?width:\s*max\(100%, 44px\);[\s\S]*?height:\s*max\(100%, 44px\);/);
});

test("every clear-search control is reachable on touch", () => {
  const sources = [
    "src/components/ui/index.tsx",
    "src/app/(dashboard)/payments/page.tsx",
    "src/app/(dashboard)/sales/page.tsx",
    "src/app/(dashboard)/bank-deposits/page.tsx",
    "src/app/(dashboard)/investors/page.tsx",
  ];
  for (const source of sources) {
    const at = readFileSync(source, "utf8").indexOf('aria-label="Clear search"');
    assert.ok(at > 0, `${source} should expose a clear-search control`);
    const before = readFileSync(source, "utf8").slice(Math.max(0, at - 400), at);
    assert.match(before, /tap-target/, `${source} clear-search is only ~17x14 without tap-target`);
  }
});
