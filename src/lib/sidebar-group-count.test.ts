import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

test("sidebar section headers do not display module counts", () => {
  const sidebar = readFileSync("src/components/layout/Sidebar.tsx", "utf8");

  assert.doesNotMatch(sidebar, /\{group\.items\.length\}/);
});
