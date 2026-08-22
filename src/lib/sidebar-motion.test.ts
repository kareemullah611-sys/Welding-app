import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";

test("desktop sidebar uses a contained book-hinge transition without transition-all", () => {
  const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");
  const layout = readFileSync("src/components/layout/AppLayout.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(sidebar, /desktop-book-sidebar/);
  assert.match(sidebar, /sidebar-book-cover/);
  assert.doesNotMatch(sidebar, /hidden lg:block fixed top-3 bottom-3 z-30 transition-all/);
  assert.match(layout, /sidebar-layout-shift/);
  assert.match(styles, /perspective:/);
  assert.match(styles, /transform-origin:/);
  assert.match(styles, /will-change: width, transform/);
  assert.match(styles, /contain: layout paint style/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("mobile sidebar uses the same direction-aware book-cover motion", () => {
  const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");

  assert.match(sidebar, /mobile-book-sidebar/);
  assert.match(sidebar, /data-open=\{mobileOpen\}/);
  assert.match(styles, /\.mobile-book-sidebar/);
  assert.match(styles, /rotateY\(-92deg\)/);
  assert.match(styles, /data-direction="rtl"/);
  assert.doesNotMatch(sidebar, /mobileOpen \? "translate-x-0 pointer-events-auto"/);
});
