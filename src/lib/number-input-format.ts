export type NormalizeNumberInputOptions = {
  allowNegative?: boolean;
  maxDecimalPlaces?: number;
};

export function normalizeFormattedNumberInput(
  input: string,
  options: NormalizeNumberInputOptions = {}
): string {
  const allowNegative = options.allowNegative === true;
  const maxDecimalPlaces = options.maxDecimalPlaces;
  let source = String(input || "").replace(/,/g, "").replace(/\s+/g, "");
  let output = "";
  let hasDecimal = false;
  let hasSign = false;

  for (const char of source) {
    if (char >= "0" && char <= "9") {
      output += char;
      continue;
    }
    if (char === "." && !hasDecimal) {
      output += ".";
      hasDecimal = true;
      continue;
    }
    if (char === "-" && allowNegative && !hasSign && output.length === 0) {
      output += "-";
      hasSign = true;
    }
  }

  if (maxDecimalPlaces !== undefined && maxDecimalPlaces >= 0 && output.includes(".")) {
    const sign = output.startsWith("-") ? "-" : "";
    const unsigned = sign ? output.slice(1) : output;
    const [integerPart, decimalPart = ""] = unsigned.split(".");
    output = `${sign}${integerPart}.${decimalPart.slice(0, maxDecimalPlaces)}`;
  }

  return output;
}

export function formatNumberInputDisplay(
  input: string | number | null | undefined,
  options: NormalizeNumberInputOptions = {}
): string {
  const normalized = normalizeFormattedNumberInput(String(input ?? ""), options);
  if (!normalized || normalized === "-") return normalized;

  const isNegative = normalized.startsWith("-");
  const unsigned = isNegative ? normalized.slice(1) : normalized;
  const hasTrailingDecimal = unsigned.endsWith(".");
  const [integerPart, decimalPart] = unsigned.split(".");
  const formattedInteger = (integerPart || "0").replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const suffix = decimalPart !== undefined ? `.${decimalPart}` : hasTrailingDecimal ? "." : "";

  return `${isNegative ? "-" : ""}${formattedInteger}${suffix}`;
}

export function parseFormattedNumber(
  input: string | number | null | undefined,
  options: NormalizeNumberInputOptions = {}
): number | null {
  const normalized = normalizeFormattedNumberInput(String(input ?? ""), options);
  if (!normalized || normalized === "-" || normalized === ".") return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function countNumericChars(input: string): number {
  return normalizeFormattedNumberInput(input).length;
}

export function caretFromNumericCharCount(displayValue: string, numericCharCount: number): number {
  if (numericCharCount <= 0) return 0;
  let seen = 0;
  for (let index = 0; index < displayValue.length; index += 1) {
    if (/[\d.-]/.test(displayValue[index])) {
      seen += 1;
      if (seen >= numericCharCount) return index + 1;
    }
  }
  return displayValue.length;
}
