import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("theme system supports persisted light, dark, and system modes without startup flash", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const theme = readFileSync("src/hooks/useTheme.tsx", "utf8");
  const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

  assert.match(layout, /beforeInteractive/);
  assert.match(layout, /mrf-theme/);
  assert.match(theme, /"light"\s*\|\s*"dark"\s*\|\s*"system"/);
  assert.match(theme, /localStorage\.setItem/);
  assert.match(theme, /prefers-color-scheme:\s*dark/);
  assert.match(theme, /addEventListener\("change"/);
  assert.match(sidebar, /ThemeSwitcher/);
});

test("theme bootstrap script is rendered inside the document head", () => {
  const layout = readFileSync("src/app/layout.tsx", "utf8");

  assert.match(layout, /<head>[\s\S]*<Script id="theme-init"[\s\S]*<\/head>/);
  assert.doesNotMatch(layout, /<\/head>\s*<Script id="theme-init"/);
});

test("dark mode defines semantic surfaces, form controls, financial states, charts, and print isolation", () => {
  const css = readFileSync("src/app/globals.css", "utf8");

  for (const token of ["--surface", "--surface-elevated", "--text-primary", "--text-secondary", "--text-muted", "--success", "--warning", "--danger"]) {
    assert.match(css, new RegExp(token));
  }
  assert.match(css, /\.dark \.input-field/);
  assert.match(css, /\.dark \.recharts-cartesian-grid/);
  assert.match(css, /@media print[\s\S]*color-scheme:\s*light/);
});

test("dark mode preserves the product's warm burgundy and neutral design language", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

  assert.match(css, /--background:\s*345\s+11%\s+8%/);
  assert.match(css, /--surface:\s*345\s+10%\s+12%/);
  assert.match(css, /--border:\s*345\s+12%\s+28%/);
  assert.doesNotMatch(sidebar, /dark:(?:bg|from|via|to|border)-slate/);
});

test("completed lot rows keep a dark surface with a restrained completion accent", () => {
  const lots = readFileSync("src/app/(dashboard)/lots/page.tsx", "utf8");

  assert.match(lots, /dark:bg-emerald-950\/25/);
  assert.match(lots, /dark:border-emerald-700\/50/);
  assert.match(lots, /dark:hover:bg-emerald-900\/30/);
});
