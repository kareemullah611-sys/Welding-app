"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  caretFromNumericCharCount,
  countNumericChars,
  formatNumberInputDisplay,
  normalizeFormattedNumberInput,
  parseFormattedNumber,
  type NormalizeNumberInputOptions,
} from "@/lib/number-input-format";

function placeCaretAtEnd(element: HTMLElement) {
  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(element);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

type FormattedNumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "inputMode" | "value" | "defaultValue" | "onChange"
> &
  NormalizeNumberInputOptions & {
    value: number | string | null | undefined;
    onValueChange: (value: number | null, rawValue: string) => void;
  };

export function FormattedNumberInput({
  value,
  onValueChange,
  allowNegative,
  maxDecimalPlaces,
  className,
  ...props
}: FormattedNumberInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nextCaretRef = useRef<number | null>(null);
  const formatOptions = useMemo(() => ({ allowNegative, maxDecimalPlaces }), [allowNegative, maxDecimalPlaces]);
  const displayValue = formatNumberInputDisplay(value, formatOptions);

  useLayoutEffect(() => {
    const input = inputRef.current;
    const nextCaret = nextCaretRef.current;
    if (!input || nextCaret === null || document.activeElement !== input) return;
    input.setSelectionRange(nextCaret, nextCaret);
    nextCaretRef.current = null;
  }, [displayValue]);

  return (
    <input
      {...props}
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={displayValue}
      className={className}
      onChange={(event) => {
        const rawDisplayValue = event.currentTarget.value;
        const cursor = event.currentTarget.selectionStart ?? rawDisplayValue.length;
        const charsBeforeCursor = countNumericChars(rawDisplayValue.slice(0, cursor));
        const rawValue = normalizeFormattedNumberInput(rawDisplayValue, formatOptions);
        const nextDisplayValue = formatNumberInputDisplay(rawValue, formatOptions);
        nextCaretRef.current = caretFromNumericCharCount(nextDisplayValue, charsBeforeCursor);
        onValueChange(parseFormattedNumber(rawValue, formatOptions), rawValue);
      }}
      onWheel={(event) => event.currentTarget.blur()}
    />
  );
}

type FormattedNumberEditableProps = Omit<
  React.HTMLAttributes<HTMLDivElement>,
  "children" | "contentEditable" | "onInput"
> &
  NormalizeNumberInputOptions & {
    value: number | string | null | undefined;
    onValueChange: (value: number | null, rawValue: string) => void;
  };

export function FormattedNumberEditable({
  value,
  onValueChange,
  allowNegative,
  maxDecimalPlaces,
  ...props
}: FormattedNumberEditableProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const formatOptions = useMemo(() => ({ allowNegative, maxDecimalPlaces }), [allowNegative, maxDecimalPlaces]);
  const displayValue = formatNumberInputDisplay(value, formatOptions);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || focused) return;
    element.textContent = displayValue;
  }, [displayValue, focused]);

  return (
    <div
      {...props}
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      inputMode="decimal"
      onFocus={(event) => {
        setFocused(true);
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        event.currentTarget.textContent = formatNumberInputDisplay(event.currentTarget.textContent || "", formatOptions);
        props.onBlur?.(event);
      }}
      onInput={(event) => {
        const rawValue = normalizeFormattedNumberInput(event.currentTarget.textContent || "", formatOptions);
        event.currentTarget.textContent = formatNumberInputDisplay(rawValue, formatOptions);
        placeCaretAtEnd(event.currentTarget);
        onValueChange(parseFormattedNumber(rawValue, formatOptions), rawValue);
      }}
    >
      {displayValue}
    </div>
  );
}
