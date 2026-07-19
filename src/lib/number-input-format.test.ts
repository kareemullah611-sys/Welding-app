import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  caretFromNumericCharCount,
  formatNumberInputDisplay,
  normalizeFormattedNumberInput,
  parseFormattedNumber,
} from "@/lib/number-input-format";

test("formats thousands separators while preserving decimals", () => {
  assert.equal(formatNumberInputDisplay("1000"), "1,000");
  assert.equal(formatNumberInputDisplay("1000000"), "1,000,000");
  assert.equal(formatNumberInputDisplay("1234567.89"), "1,234,567.89");
  assert.equal(formatNumberInputDisplay("1234."), "1,234.");
});

test("normalizes pasted or typed formatted values to raw numeric text", () => {
  assert.equal(normalizeFormattedNumberInput("1,234,567.89"), "1234567.89");
  assert.equal(normalizeFormattedNumberInput("PKR 1,234.56"), "1234.56");
  assert.equal(normalizeFormattedNumberInput("12.34.56"), "12.3456");
});

test("parses formatted values as clean numbers for saving", () => {
  assert.equal(parseFormattedNumber("1,234,567.89"), 1234567.89);
  assert.equal(parseFormattedNumber(""), null);
});

test("maps caret after comma insertion", () => {
  assert.equal(caretFromNumericCharCount("1,000", 4), 5);
  assert.equal(caretFromNumericCharCount("1,234,567.89", 7), 9);
});
