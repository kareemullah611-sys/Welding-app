"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getEmbedFromLocation } from "@/lib/quickform-embed";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ProcessingSpinner } from "@/components/ui/ProcessingLoader";
import { cn } from "@/lib/utils";
import { buildPaginationItems, getPaginationRange } from "@/lib/pagination";
import { X } from "lucide-react";

const MODAL_FOCUSABLE_SELECTOR = [
  "input:not([type='hidden']):not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const SUBMIT_LABEL_REGEX = /(save|create|record|submit|apply|approve|send|confirm|delete|reset|complete|reopen|correct)/i;

function isVisibleFocusable(el: HTMLElement) {
  return !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.getClientRects().length > 0;
}

function getModalFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(MODAL_FOCUSABLE_SELECTOR))
    .filter(isVisibleFocusable);
}

function moveModalFocus(container: HTMLElement, direction: 1 | -1) {
  const focusables = getModalFocusableElements(container);
  if (!focusables.length) return;
  const current = document.activeElement as HTMLElement | null;
  const currentIndex = current ? focusables.indexOf(current) : -1;
  const start = currentIndex >= 0 ? currentIndex : (direction === 1 ? -1 : 0);
  const nextIndex = (start + direction + focusables.length) % focusables.length;
  focusables[nextIndex].focus();
}

function isSubmitLikeButton(el: HTMLElement) {
  if (!(el instanceof HTMLButtonElement) || el.disabled) return false;
  if (el.dataset.formSubmit === "true") return true;
  if (typeof el.className === "string" && el.className.includes("btn-primary")) return true;
  return SUBMIT_LABEL_REGEX.test((el.textContent || "").trim());
}

function normalizeForSearchValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeForSearchValue).join(" ");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(normalizeForSearchValue).join(" ");
  return "";
}

// ============================================================
// PAGE HEADER
// ============================================================
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-6 overflow-hidden rounded-[1.6rem] border border-white/75 bg-[linear-gradient(135deg,rgba(255,248,239,0.95),rgba(245,233,219,0.82))] px-5 py-5 shadow-[0_28px_70px_-42px_rgba(51,42,33,0.38)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#71717a]">Workspace</p>
        <h1 className="text-2xl font-bold text-[#2A0608] tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[#52525b]">{subtitle}</p>}
      </div>
      {action && <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-shrink-0 sm:justify-end">{action}</div>}
      </div>
    </div>
  );
}

// ============================================================
// STATS CARD
// ============================================================
const colorMap = {
  blue:   { iconBg: "bg-[#dff1f6]",   iconText: "text-[#176b83]",   accent: "from-[#edf8fb] to-white",   valueTxt: "text-[#14596d]", ring: "ring-[#d2e9ef]" },
  green:  { iconBg: "bg-[#e4f3e9]",   iconText: "text-[#2e7755]",   accent: "from-[#f1fbf4] to-white",   valueTxt: "text-[#2a6248]", ring: "ring-[#d7ebdd]" },
  red:    { iconBg: "bg-[#fde9e4]",   iconText: "text-[#b2452d]",   accent: "from-[#fff3ef] to-white",   valueTxt: "text-[#97331d]", ring: "ring-[#f2d9d1]" },
  yellow: { iconBg: "bg-[#fff1d6]",   iconText: "text-[#a36a12]",   accent: "from-[#fff9eb] to-white",   valueTxt: "text-[#89550e]", ring: "ring-[#f5e6c4]" },
  purple: { iconBg: "bg-[#efe6ff]",   iconText: "text-[#7046b7]",   accent: "from-[#f7f1ff] to-white",   valueTxt: "text-[#5f399e]", ring: "ring-[#e5daf7]" },
};

export function StatsCard({
  title,
  value,
  subtitle,
  icon,
  color = "blue",
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  color?: "blue" | "green" | "red" | "yellow" | "purple";
}) {
  const c = colorMap[color];
  return (
    <Card className={cn("border-0 bg-transparent shadow-none")}>
      <CardContent className={cn("stat-card bg-gradient-to-br", c.accent, c.ring, "ring-1 p-4 sm:p-5")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#71717a] leading-snug line-clamp-2">{title}</p>
            <p className={cn("text-sm sm:text-lg font-bold mt-1.5 leading-tight tabular-nums", c.valueTxt)}>{value}</p>
            {subtitle && <p className="mt-1.5 text-xs leading-snug text-[#52525b]">{subtitle}</p>}
          </div>
          {icon && (
            <div className={cn("hidden sm:flex h-11 w-11 rounded-2xl items-center justify-center text-xl flex-shrink-0 shadow-inner", c.iconBg, c.iconText)}>
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================
// DATA TABLE
// ============================================================
interface Column<T> {
  key: string;
  label: string;
  render?: (item: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  loading?: boolean;
  emptyMessage?: string;
  onRowClick?: (item: T) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchMinChars?: number;
  searchColumnKeys?: string[];
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  pagination?: PaginationConfig;
  stripedRows?: boolean;
  rowClassName?: (item: T, index: number) => string;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  loading,
  emptyMessage = "No data found",
  onRowClick,
  searchable = true,
  searchPlaceholder = "Search all columns...",
  searchMinChars = 2,
  searchColumnKeys,
  searchValue,
  onSearchChange,
  pagination,
  stripedRows = false,
  rowClassName,
}: DataTableProps<T>) {
  const [internalSearch, setInternalSearch] = useState("");
  const [selectedSearchColumn, setSelectedSearchColumn] = useState("__all__");
  const [activeMatchIndex, setActiveMatchIndex] = useState(-1);
  const pathname = usePathname();
  const restoredSearchRef = useRef(false);
  const restoredColumnRef = useRef(false);
  const rowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const minChars = Math.max(1, searchMinChars || 2);
  const activeSearch = (searchValue ?? internalSearch).trim();
  const searchableColumns = useMemo(() => {
    const allowed = new Set(searchColumnKeys || []);
    const hasAllowList = allowed.size > 0;
    return columns.filter((col) => {
      if (!col.label || col.key === "actions") return false;
      if (!hasAllowList) {
        const key = String(col.key || "").toLowerCase();
        if (key === "status" || key.endsWith("status")) return false;
        if (key === "date" || key.endsWith("date")) return false;
        return true;
      }
      return allowed.has(col.key);
    });
  }, [columns, searchColumnKeys]);
  const searchStorageKey = useMemo(() => {
    const normalizedPlaceholder = String(searchPlaceholder || "search")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    return `datatable:search:${pathname}:${normalizedPlaceholder || "search"}`;
  }, [pathname, searchPlaceholder]);
  const columnStorageKey = useMemo(() => `${searchStorageKey}:column`, [searchStorageKey]);

  useEffect(() => {
    restoredSearchRef.current = false;
    restoredColumnRef.current = false;
  }, [searchStorageKey]);

  useEffect(() => {
    if (!searchable || restoredSearchRef.current || typeof window === "undefined") return;
    const stored = window.sessionStorage.getItem(searchStorageKey);
    if (!stored) return;

    restoredSearchRef.current = true;
    if (onSearchChange) {
      if ((searchValue ?? "") !== stored) onSearchChange(stored);
      return;
    }
    setInternalSearch(stored);
  }, [onSearchChange, searchStorageKey, searchable, searchValue]);

  useEffect(() => {
    if (!searchable || typeof window === "undefined") return;
    const currentSearch = searchValue ?? internalSearch;
    if (currentSearch) {
      window.sessionStorage.setItem(searchStorageKey, currentSearch);
      return;
    }
    window.sessionStorage.removeItem(searchStorageKey);
  }, [internalSearch, searchStorageKey, searchable, searchValue]);

  useEffect(() => {
    if (!searchable || restoredColumnRef.current || typeof window === "undefined") return;
    const storedColumn = window.sessionStorage.getItem(columnStorageKey);
    if (!storedColumn) return;
    if (storedColumn === "__all__" || searchableColumns.some((col) => col.key === storedColumn)) {
      setSelectedSearchColumn(storedColumn);
    }
    restoredColumnRef.current = true;
  }, [columnStorageKey, searchable, searchableColumns]);

  useEffect(() => {
    if (!searchable || typeof window === "undefined") return;
    window.sessionStorage.setItem(columnStorageKey, selectedSearchColumn);
  }, [columnStorageKey, searchable, selectedSearchColumn]);

  const filteredData = useMemo(() => {
    if (!searchable || activeSearch.length < minChars) return data;
    const needle = activeSearch.toLowerCase();
    return data.filter((item) => {
      if (selectedSearchColumn !== "__all__") {
        return normalizeForSearchValue(item[selectedSearchColumn]).toLowerCase().includes(needle);
      }
      const byColumns = searchableColumns
        .map((col) => normalizeForSearchValue(item[col.key]))
        .join(" ")
        .toLowerCase();
      if (byColumns.includes(needle)) return true;
      return false;
    });
  }, [activeSearch, data, minChars, searchable, searchableColumns, selectedSearchColumn]);

  useEffect(() => {
    if (!activeSearch || activeSearch.length < minChars || filteredData.length === 0) {
      setActiveMatchIndex(-1);
      return;
    }
    setActiveMatchIndex((current) => (current >= 0 && current < filteredData.length ? current : 0));
  }, [activeSearch, filteredData.length, minChars]);

  useEffect(() => {
    if (activeMatchIndex < 0) return;
    rowRefs.current[activeMatchIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeMatchIndex]);

  const showSearchMeta = searchable && activeSearch.length > 0;
  const highlightSearchText = (value: unknown): React.ReactNode => {
    const text = value == null ? "" : String(value);
    if (!searchable || activeSearch.length < minChars || !text) return text;

    const needle = activeSearch.toLowerCase();
    const haystack = text.toLowerCase();
    if (!needle || !haystack.includes(needle)) return text;

    const nodes: React.ReactNode[] = [];
    let cursor = 0;
    let key = 0;
    while (cursor < text.length) {
      const matchAt = haystack.indexOf(needle, cursor);
      if (matchAt === -1) {
        nodes.push(<React.Fragment key={`txt-${key++}`}>{text.slice(cursor)}</React.Fragment>);
        break;
      }
      if (matchAt > cursor) {
        nodes.push(<React.Fragment key={`txt-${key++}`}>{text.slice(cursor, matchAt)}</React.Fragment>);
      }
      nodes.push(
        <mark key={`hit-${key++}`} className="rounded bg-amber-100 px-0.5 text-inherit">
          {text.slice(matchAt, matchAt + needle.length)}
        </mark>
      );
      cursor = matchAt + needle.length;
    }
    return <>{nodes}</>;
  };
  const highlightSearchNode = (node: React.ReactNode): React.ReactNode => {
    if (!searchable || activeSearch.length < minChars) return node;
    if (node == null || typeof node === "boolean") return node;
    if (typeof node === "string" || typeof node === "number") return highlightSearchText(node);
    if (Array.isArray(node)) return node.map((child, index) => <React.Fragment key={index}>{highlightSearchNode(child)}</React.Fragment>);
    if (!React.isValidElement(node)) return node;

    const childProps = (node.props as { children?: React.ReactNode }) || {};
    if (typeof childProps.children === "undefined") return node;
    return React.cloneElement(node, undefined, highlightSearchNode(childProps.children));
  };

  return (
    <div className="rounded-[1.4rem] border border-white/70 bg-white/85 shadow-[0_26px_70px_-42px_rgba(51,42,33,0.35)] backdrop-blur-xl">
      {searchable && (
        <div className="flex flex-col gap-1 border-b border-[#e4e4e7] bg-[#f4f4f5]/90 px-3 py-3 sm:px-4">
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="search"
              value={searchValue ?? internalSearch}
              onChange={(e) => {
                const next = e.target.value;
                if (onSearchChange) onSearchChange(next);
                else setInternalSearch(next);
              }}
              onKeyDown={(event) => {
                if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
                if (activeSearch.length < minChars || filteredData.length === 0) return;
                event.preventDefault();
                setActiveMatchIndex((current) => {
                  const start = current >= 0 ? current : 0;
                  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
                    return (start + 1) % filteredData.length;
                  }
                  return (start - 1 + filteredData.length) % filteredData.length;
                });
              }}
              placeholder={searchPlaceholder}
              className="input-field h-10 w-full text-base sm:h-9 sm:max-w-sm sm:text-sm"
            />
            <select
              value={selectedSearchColumn}
              onChange={(event) => {
                setSelectedSearchColumn(event.target.value);
                setActiveMatchIndex(-1);
              }}
              className="input-field h-10 w-full text-base sm:h-9 sm:w-56 sm:text-sm"
              aria-label="Search specific column"
            >
              <option value="__all__">All Columns</option>
              {searchableColumns.map((col) => (
                <option key={col.key} value={col.key}>
                  {col.label}
                </option>
              ))}
            </select>
          </div>
          {showSearchMeta && activeSearch.length < minChars && (
            <p className="text-[11px] text-gray-500">
              Type at least {minChars} characters to filter this list.
            </p>
          )}
          {showSearchMeta && activeSearch.length >= minChars && (
            <p className="text-[11px] text-gray-500">
              Showing {filteredData.length} matching record{filteredData.length === 1 ? "" : "s"}
              {activeMatchIndex >= 0 ? ` · Selected ${activeMatchIndex + 1}/${filteredData.length}` : ""}.
            </p>
          )}
        </div>
      )}
      <div className="overflow-visible">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-[#e4e4e7] bg-[#f4f4f5]/95 hover:bg-[#f4f4f5]/95">
              {columns.map((col) => (
                <TableHead key={col.key} className={cn("text-xs font-semibold text-gray-500 uppercase tracking-wider py-3", col.className)}>
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="py-14">
                  <div className="flex justify-center">
                    <ProcessingSpinner size="md" label="Loading" />
                  </div>
                </TableCell>
              </TableRow>
            ) : filteredData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <div className="h-10 w-10 rounded-xl border border-[#d4d4d8] bg-[#f4f4f5]" />
                    <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredData.map((item, idx) => (
                <TableRow
                  key={idx}
                  ref={(node) => { rowRefs.current[idx] = node; }}
                  onClick={() => onRowClick?.(item)}
                  className={cn(
                    "border-b border-[#e4e4e7] transition-colors",
                    stripedRows && idx % 2 === 1 && "bg-[#fafafa]",
                    onRowClick ? "cursor-pointer hover:bg-[#f5e8eb]" : "hover:bg-[#fafafa]"
                    ,rowClassName?.(item, idx)
                  )}
                >
                  {columns.map((col) => {
                    const isDate = !col.render && col.key.toLowerCase().includes("date") && typeof item[col.key] === "string" && item[col.key]?.match(/^\d{4}-\d{2}-\d{2}/);
                    const displayValue = isDate ? formatDate(item[col.key]) : item[col.key];
                    return (
                      <TableCell key={col.key} className={cn("text-sm text-gray-700 py-3", isDate && "whitespace-nowrap", col.className)}>
                        {(() => {
                          const renderedValue = col.render ? col.render(item) : displayValue;
                          const shouldHighlight =
                            col.key !== "actions" &&
                            activeSearch.length >= minChars &&
                            (selectedSearchColumn === "__all__" || selectedSearchColumn === col.key);
                          return shouldHighlight
                            ? highlightSearchNode(renderedValue)
                            : renderedValue;
                        })()}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pagination && pagination.totalPages > 1 && <PaginationBar pagination={pagination} />}
    </div>
  );
}

export interface PaginationConfig {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  pageSize?: number;
}

export function PaginationBar({
  pagination,
  className,
  bordered = true,
}: {
  pagination: PaginationConfig;
  className?: string;
  bordered?: boolean;
}) {
  const pageSize = pagination.pageSize || 20;
  const pageItems = buildPaginationItems(pagination.page, pagination.totalPages);
  const range = getPaginationRange({ page: pagination.page, pageSize, total: pagination.total });

  return (
    <div
      className={cn(
        "flex flex-col gap-3 bg-[#f4f4f5]/90 px-4 py-3 sm:flex-row sm:items-center sm:justify-between",
        bordered && "border-t border-[#e4e4e7]",
        className
      )}
    >
      <p className="text-xs italic text-[#6b7280]">
        Showing {range.start}-{range.end} of {pagination.total} transactions
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => pagination.onPageChange(pagination.page - 1)}
          disabled={pagination.page <= 1}
          className="h-9 px-3 text-xs sm:h-8"
        >
          Previous
        </Button>
        {pageItems.map((item, index) =>
          item === "..." ? (
            <span key={`ellipsis-${index}`} className="px-1.5 text-xs text-gray-400">
              ...
            </span>
          ) : (
            <button
              key={item}
              type="button"
              onClick={() => pagination.onPageChange(item)}
              className={cn(
                "h-9 min-w-9 rounded-md border px-2 text-xs font-semibold transition-colors sm:h-8 sm:min-w-8",
                item === pagination.page
                  ? "border-primary-700 bg-primary-600 text-white shadow-sm"
                  : "border-[#d4d4d8] bg-white text-[#374151] hover:border-[#a1a1aa] hover:bg-[#f5e8eb]"
              )}
            >
              {item}
            </button>
          )
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => pagination.onPageChange(pagination.page + 1)}
          disabled={pagination.page >= pagination.totalPages}
          className="h-9 px-3 text-xs sm:h-8"
        >
          Next
        </Button>
      </div>
    </div>
  );
}

// ============================================================
// MODAL

// ============================================================
export function Modal({
  open,
  onClose,
  title,
  children,
  size = "md",
  inline = false,
  hideHeader = false,
  bodyClassName,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  inline?: boolean;
  hideHeader?: boolean;
  bodyClassName?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const searchParams = useSearchParams();
  const embedRoute = getEmbedFromLocation() || searchParams.get("embed") === "1";
  const inlineMode = inline || embedRoute;
  const suppressHeader = hideHeader || embedRoute;

  useEffect(() => setMounted(true), []);

  const handleFormKeyNav = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const target = event.target as HTMLElement;
    const hasLocalNav = Boolean(target.closest("[data-modal-nav='local']"));

    if (hasLocalNav) return;

    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      moveModalFocus(container, -1);
      return;
    }

    if (event.key === "Enter") {
      if (isSubmitLikeButton(target)) {
        event.preventDefault();
        event.stopPropagation();
        (target as HTMLButtonElement).click();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const focusables = getModalFocusableElements(container);
      const currentIndex = focusables.indexOf(target);
      const isLastField = currentIndex >= 0 && currentIndex === focusables.length - 1;
      if (isLastField) {
        const submitButton = focusables.find(isSubmitLikeButton);
        if (submitButton) {
          (submitButton as HTMLButtonElement).click();
          return;
        }
      }
      moveModalFocus(container, 1);
      return;
    }

    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      moveModalFocus(container, event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      event.stopPropagation();
      moveModalFocus(container, 1);
      return;
    }

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      moveModalFocus(container, -1);
    }
  };

  const sizes = {
    sm: "max-w-md",
    md: "max-w-lg",
    lg: "max-w-2xl",
    xl: "max-w-6xl",
  };

  if (!mounted) return null;

  if (inlineMode) {
    if (!open) return null;
    return (
      <div
        onKeyDownCapture={handleFormKeyNav}
        className={cn(
          "h-full min-h-0 w-full overflow-y-auto overscroll-contain",
          bodyClassName || "px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-4 sm:py-4"
        )}
      >
        {children}
      </div>
    );
  }

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        hideCloseButton={suppressHeader}
        className={cn("w-full gap-0 p-0 overflow-hidden border border-[#d4d4d8] bg-[linear-gradient(168deg,rgba(255,255,255,0.99),rgba(244,244,245,0.97))] shadow-[0_32px_80px_-42px_rgba(42,6,8,0.35)]", sizes[size])}
      >
        {!suppressHeader && (
          <DialogHeader className="px-6 py-4 border-b border-[#e4e4e7] bg-[rgba(255,255,255,0.96)] flex-shrink-0">
            <DialogTitle asChild><div className="text-base font-semibold tracking-[0.01em] text-[#2A0608]">{title}</div></DialogTitle>
          </DialogHeader>
        )}
        <div onKeyDownCapture={handleFormKeyNav} className={cn("overflow-y-auto max-h-[75vh]", suppressHeader ? "" : "px-6 py-5", bodyClassName)}>{children}</div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// STATUS BADGE
// ============================================================
const badgeConfig: Record<string, { cls: string; dot: string }> = {
  active:       { cls: "bg-green-50 text-green-800 border-green-200 hover:bg-green-50",   dot: "bg-green-500" },
  cancelled:    { cls: "bg-red-50 text-red-800 border-red-200 hover:bg-red-50",           dot: "bg-red-500" },
  marked_short: { cls: "bg-yellow-50 text-yellow-800 border-yellow-200 hover:bg-yellow-50", dot: "bg-yellow-500" },
  ongoing:      { cls: "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-50",       dot: "bg-blue-500" },
  completed:    { cls: "bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-100",     dot: "bg-gray-400" },
  paid:         { cls: "bg-green-50 text-green-800 border-green-200 hover:bg-green-50",   dot: "bg-green-500" },
  pending:      { cls: "bg-yellow-50 text-yellow-800 border-yellow-200 hover:bg-yellow-50", dot: "bg-yellow-500" },
  partial:      { cls: "bg-orange-50 text-orange-800 border-orange-200 hover:bg-orange-50", dot: "bg-orange-500" },
};

export function StatusBadge({ status }: { status: string }) {
  if (!status) return <span className="text-xs text-muted-foreground">—</span>;
  const config = badgeConfig[status] ?? { cls: "bg-blue-50 text-blue-800 border-blue-200 hover:bg-blue-50", dot: "bg-blue-500" };
  const label = status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Badge variant="outline" className={cn("text-xs font-medium gap-1.5 pl-2", config.cls)}>
      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", config.dot)} />
      {label}
    </Badge>
  );
}

// ============================================================
// FORMAT HELPERS
// ============================================================
export function formatCurrency(amount: number, symbol = "Rs"): string {
  return `${symbol} ${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined || isNaN(num as number)) return "0";
  return (num as number).toLocaleString("en-US");
}

export { ProcessingSpinner } from "@/components/ui/ProcessingLoader";
export { default as ProcessingLoader } from "@/components/ui/ProcessingLoader";
export { default as CuttingDiscSpinner, DEFAULT_CUTTING_DISC_SRC } from "@/components/ui/CuttingDiscSpinner";

export function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}
