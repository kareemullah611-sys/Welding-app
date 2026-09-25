import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("lot revenue excludes FX gain accounts because authoritative P&L bridges FX separately", () => {
  const source = readFileSync("src/lib/period-profit-report-data.ts", "utf8");

  assert.match(source, /accountById\.get\(row\.accountId\)\?\.code !== "FX-GAIN"/);
});
