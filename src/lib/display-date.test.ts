import test from "node:test";
import assert from "node:assert/strict";
import { formatDisplayDate } from "@/lib/display-date";

test("formatDisplayDate renders dd-mm-yy from ISO date", () => {
  assert.equal(formatDisplayDate("2026-03-15"), "15-03-26");
});

test("formatDisplayDate renders dd-mm-yy from ISO datetime", () => {
  assert.equal(formatDisplayDate("2026-03-15T00:00:00.000Z"), "15-03-26");
});
