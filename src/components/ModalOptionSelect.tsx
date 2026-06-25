"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { findModalFormRoot, focusNextModalField, moveModalFocus } from "@/lib/modal-keyboard";
import { cn } from "@/lib/utils";

export type ModalOptionSelectOption = {
  value: string;
  label: string;
  hint?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: ModalOptionSelectOption[];
  label?: string;
  className?: string;
  placeholder?: string;
};

/** Keyboard-friendly option list for quickform modals (Enter opens, Tab highlights, Enter picks). */
export default function ModalOptionSelect({
  value,
  onChange,
  options,
  label,
  className,
  placeholder = "Select…",
}: Props) {
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const selected = options[selectedIndex] || options[0];

  const openList = (index = selectedIndex) => {
    setFocused(true);
    setOpen(true);
    setActiveIndex(index >= 0 ? index : 0);
  };

  useEffect(() => {
    const el = triggerRef.current;
    if (!el) return;
    const onActivate = () => {
      setFocused(true);
      setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    };
    el.addEventListener("modal-field-activate", onActivate);
    return () => el.removeEventListener("modal-field-activate", onActivate);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${listId}-opt-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, listId]);

  const applySelection = (index: number, advance = true) => {
    const opt = options[index];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
    setFocused(false);
    if (advance) {
      window.setTimeout(() => focusNextModalField(triggerRef.current!), 0);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const count = options.length;
    const dropdownOpen = open && focused;

    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      if (dropdownOpen) {
        if (e.shiftKey) {
          if (activeIndex > 0) {
            setActiveIndex((prev) => prev - 1);
          } else {
            setOpen(false);
            setFocused(false);
            const root = findModalFormRoot(triggerRef.current!);
            if (root) moveModalFocus(root, -1);
          }
        } else if (activeIndex < count - 1) {
          setActiveIndex((prev) => prev + 1);
        } else {
          setOpen(false);
          setFocused(false);
          focusNextModalField(triggerRef.current!);
        }
      } else {
        const root = findModalFormRoot(triggerRef.current!);
        if (root) moveModalFocus(root, e.shiftKey ? -1 : 1);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      openList(activeIndex);
      setActiveIndex((prev) => (prev + 1) % count);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      openList(activeIndex);
      setActiveIndex((prev) => (prev - 1 + count) % count);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!dropdownOpen) {
        openList(selectedIndex);
        return;
      }
      applySelection(activeIndex);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setFocused(false);
    }
  };

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      {label ? <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label> : null}
      <button
        ref={triggerRef}
        type="button"
        data-modal-nav="local"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-opt-${activeIndex}` : undefined}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          window.setTimeout(() => {
            if (wrapperRef.current?.contains(document.activeElement)) return;
            setOpen(false);
            setFocused(false);
          }, 120);
        }}
        onClick={() => {
          if (open) {
            setOpen(false);
            setFocused(false);
          } else {
            openList(selectedIndex);
          }
        }}
        className={cn(
          "select-field flex w-full items-center justify-between gap-2 text-left",
          open && "border-gray-400 ring-2 ring-gray-300/60"
        )}
      >
        <span className="truncate leading-normal">{selected?.label || placeholder}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-gray-400 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {options.map((opt, idx) => (
            <li key={opt.value} role="presentation">
              <button
                id={`${listId}-opt-${idx}`}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={activeIndex === idx || value === opt.value}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySelection(idx);
                }}
                className={cn(
                  "w-full px-3 py-2.5 text-left text-sm",
                  activeIndex === idx
                    ? "bg-gray-100 ring-1 ring-inset ring-gray-300"
                    : "hover:bg-gray-50",
                  value === opt.value && activeIndex !== idx && "font-medium text-gray-900"
                )}
              >
                <div className="font-medium text-gray-900">{opt.label}</div>
                {opt.hint ? <div className="mt-0.5 text-xs text-gray-500">{opt.hint}</div> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
