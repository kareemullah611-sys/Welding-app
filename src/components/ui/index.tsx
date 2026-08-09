"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { usePathname } from "next/navigation";
import { getEmbedFromLocation } from "@/lib/quickform-embed";
import {
  Dialog,
  DialogClose,
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
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format-helpers";
import { buildPaginationItems, getPaginationRange, DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
import {
  handleSelectDropdownTab,
  handleSelectEnter,
  isModalEnterAdvanceField,
  isSubmitLikeButton,
  moveModalFocus,
  openNativePicker,
  focusFirstModalField,
} from "@/lib/modal-keyboard";
import { X, ChevronLeft, ChevronRight, Inbox, CheckCircle2, AlertTriangle } from "lucide-react";
import { TableSkeleton } from "@/components/ui/skeleton";

function usesNativeFieldKeyboard(el: HTMLElement) {
  if (el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return ["date", "datetime-local", "time", "month", "week"].includes(el.type);
  }
  return false;
}

function handleModalFieldChange(_event: React.FormEvent<HTMLDivElement>) {
  // Reserved for modal field change hooks (e.g. clearing custom picker state).
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

/** Columns that are display-only or not useful as search scopes in list tables. */
const NON_SEARCHABLE_COLUMN_KEYS = new Set([
  "actions",
  "country",
  "countryname",
  "countrycode",
  "utilization",
  "distribution",
  "products",
  "balance",
  "totalpurchases",
  "totalpayments",
  "salescount",
  "hajitransferscount",
  "amount",
  "totalamount",
  "debit",
  "credit",
  "currency",
  "paymentmethod",
  "destination",
  "transfertype",
  "percartonprice",
  "runningcashinhand",
  "discountamount",
  "createdby",
]);

function isDefaultSearchableColumnKey(key: string): boolean {
  const normalized = String(key || "").toLowerCase();
  if (!normalized || normalized === "actions") return false;
  if (NON_SEARCHABLE_COLUMN_KEYS.has(normalized)) return false;
  if (normalized === "status" || normalized.endsWith("status")) return false;
  if (normalized === "date" || normalized.endsWith("date")) return false;
  if (normalized === "type" || normalized.endsWith("type")) return false;
  if (normalized.endsWith("at") || normalized.endsWith("count")) return false;
  return true;
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
    <div className="module-page mb-6 rounded-[1.6rem] border border-white/60 bg-white/50 px-5 py-5 backdrop-blur-2xl backdrop-saturate-[1.8] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_24px_60px_-36px_rgba(42,6,8,0.3)]">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-[#2A0608] tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[#52525b]">{subtitle}</p>}
      </div>
      {action && <div className="flex w-full min-w-0 flex-wrap gap-2 sm:w-auto sm:flex-shrink-0 sm:justify-end">{action}</div>}
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
// EMPTY STATE
// ============================================================
export function EmptyState({
  message = "No data found",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[#e4e4e7] bg-gradient-to-b from-white to-[#f4f4f5] shadow-sm">
        <Inbox className="h-6 w-6 text-gray-400" strokeWidth={1.5} aria-hidden />
      </div>
      <p className="text-sm font-medium text-gray-500">{message}</p>
    </div>
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
  headerClassName?: string;
  width?: string;
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
  compact?: boolean;
  tableClassName?: string;
  rowClassName?: (item: T, index: number) => string;
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  loading,
  emptyMessage = "No data found",
  onRowClick,
  searchable = true,
  searchPlaceholder = "Search…",
  searchMinChars = 2,
  searchColumnKeys,
  searchValue,
  onSearchChange,
  pagination,
  stripedRows = false,
  compact = false,
  tableClassName,
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
  const isServerSideSearch = onSearchChange !== undefined;
  const searchableColumns = useMemo(() => {
    const allowed = new Set(searchColumnKeys || []);
    const hasAllowList = allowed.size > 0;
    return columns.filter((col) => {
      if (!col.label || col.key === "actions") return false;
      if (hasAllowList) return allowed.has(col.key);
      return isDefaultSearchableColumnKey(col.key);
    });
  }, [columns, searchColumnKeys]);
  const showColumnSelector = searchable && !isServerSideSearch && searchableColumns.length > 1;
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
    if (!searchable || activeSearch.length < minChars || isServerSideSearch) return data;
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
  }, [activeSearch, data, isServerSideSearch, minChars, searchable, searchableColumns, selectedSearchColumn]);

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
    <div className="module-page overflow-hidden rounded-[1.4rem] border border-white/60 bg-white/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_22px_56px_-30px_rgba(42,6,8,0.24)] backdrop-blur-2xl backdrop-saturate-[1.8]">
      {searchable && (
        <div className="border-b border-[#e4e4e7] bg-[#f4f4f5]/90 px-3 py-2 sm:px-4">
          <div className="flex flex-wrap items-center gap-2">
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
              className="input-field h-8 min-w-[7rem] flex-1 text-sm sm:max-w-xs"
            />
            {showColumnSelector && (
              <select
                value={selectedSearchColumn}
                onChange={(event) => {
                  setSelectedSearchColumn(event.target.value);
                  setActiveMatchIndex(-1);
                }}
                className="input-field h-8 w-auto max-w-[7.5rem] shrink-0 text-sm"
                aria-label="Search specific column"
              >
                <option value="__all__">All fields</option>
                {searchableColumns.map((col) => (
                  <option key={col.key} value={col.key}>
                    {col.label}
                  </option>
                ))}
              </select>
            )}
            {showSearchMeta && !isServerSideSearch && activeSearch.length > 0 && activeSearch.length < minChars && (
              <span className="text-[11px] text-gray-500">{minChars}+ chars</span>
            )}
            {showSearchMeta && !isServerSideSearch && activeSearch.length >= minChars && (
              <span className="text-[11px] text-gray-500">
                {filteredData.length} match{filteredData.length === 1 ? "" : "es"}
                {activeMatchIndex >= 0 ? ` · ${activeMatchIndex + 1}/${filteredData.length}` : ""}
              </span>
            )}
          </div>
        </div>
      )}
      <div className="module-scroll-x">
        <Table className={tableClassName}>
          {columns.some((col) => col.width) && (
            <colgroup>
              {columns.map((col) => (
                <col key={col.key} style={col.width ? { width: col.width } : undefined} />
              ))}
            </colgroup>
          )}
          <TableHeader>
            <TableRow className="border-b border-[#e4e4e7] bg-[#f4f4f5]/95 hover:bg-[#f4f4f5]/95">
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  title={col.label ? String(col.label) : undefined}
                  className={cn(
                    "text-xs font-semibold text-gray-500 align-middle",
                    compact ? "py-2 px-2 tracking-wide overflow-hidden text-ellipsis whitespace-nowrap uppercase" : "py-3 tracking-wider uppercase",
                    col.headerClassName,
                  )}
                >
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="p-0">
                  <TableSkeleton columns={Math.max(columns.length, 3)} compact={compact} />
                </TableCell>
              </TableRow>
            ) : filteredData.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="py-16 text-center">
                  <EmptyState message={emptyMessage} />
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
                      <TableCell key={col.key} className={cn(compact ? "text-xs text-gray-700 py-1.5" : "text-sm text-gray-700 py-3", isDate && "whitespace-nowrap", col.className)}>
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
  const pageSize = pagination.pageSize || DEFAULT_LIST_PAGE_SIZE;
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
          className="h-9 w-9 p-0 sm:h-8 sm:w-8"
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
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
          className="h-9 w-9 p-0 sm:h-8 sm:w-8"
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
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
  headerAccent,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  inline?: boolean;
  hideHeader?: boolean;
  bodyClassName?: string;
  headerAccent?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const modalBodyRef = useRef<HTMLDivElement>(null);
  const embedRoute = getEmbedFromLocation();
  const inlineMode = inline || embedRoute;
  const suppressHeader = hideHeader || embedRoute;

  useEffect(() => setMounted(true), []);

  // Keep the focused field visible inside the scrollable modal body when the
  // user moves between fields with Tab / arrow keys (or the mobile keyboard
  // opens). Scrolls the modal body container directly rather than relying on
  // native scrollIntoView, which can scroll the wrong ancestor and misses
  // non-input focus targets (buttons, custom nav elements).
  useEffect(() => {
    if (!open) return;
    const root = modalBodyRef.current;
    if (!root) return;

    const scrollFocusedFieldIntoView = () => {
      const target = document.activeElement as HTMLElement | null;
      if (!target || target === document.body || !root.contains(target)) return;
      const body = root.getBoundingClientRect();
      const el = target.getBoundingClientRect();
      const pad = 8;
      if (el.top < body.top + pad) {
        root.scrollTop -= body.top + pad - el.top;
      } else if (el.bottom > body.bottom - pad) {
        root.scrollTop += el.bottom - (body.bottom - pad);
      }
    };

    const onFocusIn = () => {
      // Wait a tick so focus/layout settles before scrolling.
      window.setTimeout(scrollFocusedFieldIntoView, 50);
    };

    root.addEventListener("focusin", onFocusIn);
    return () => root.removeEventListener("focusin", onFocusIn);
  }, [open, inlineMode]);

  useEffect(() => {
    if (!open) return;
    const root = modalBodyRef.current;
    if (!root) return;
    const timer = window.setTimeout(() => focusFirstModalField(root), 0);
    return () => window.clearTimeout(timer);
  }, [open, inlineMode]);

  const handleFormKeyNav = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const target = event.target as HTMLElement;
    const hasLocalNav = Boolean(target.closest("[data-modal-nav='local']"));

    if (hasLocalNav) return;

    if (event.key === "Tab") {
      if (target instanceof HTMLSelectElement && handleSelectDropdownTab(target, container, event.shiftKey)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      moveModalFocus(container, event.shiftKey ? -1 : 1);
      return;
    }

    if (event.key === "Enter") {
      if (isSubmitLikeButton(target)) {
        event.preventDefault();
        event.stopPropagation();
        (target as HTMLButtonElement).click();
        return;
      }
      if (target instanceof HTMLButtonElement) {
        event.preventDefault();
        event.stopPropagation();
        target.click();
        return;
      }
      if (target instanceof HTMLSelectElement) {
        handleSelectEnter(target, event);
        return;
      }
      if (
        target instanceof HTMLInputElement &&
        ["date", "datetime-local", "time", "month", "week"].includes(target.type)
      ) {
        event.preventDefault();
        event.stopPropagation();
        openNativePicker(target);
        return;
      }
      if (isModalEnterAdvanceField(target)) {
        event.preventDefault();
        event.stopPropagation();
        moveModalFocus(container, 1);
        return;
      }
      if (usesNativeFieldKeyboard(target)) {
        return;
      }
      return;
    }

    if (event.key === " " && target instanceof HTMLSelectElement) {
      handleSelectEnter(target, event);
      return;
    }

    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowLeft"
    ) {
      if (usesNativeFieldKeyboard(target)) return;
      event.preventDefault();
      event.stopPropagation();
      moveModalFocus(container, event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1);
    }
  };

  const sizes = {
    sm: "sm:max-w-md",
    md: "sm:max-w-lg",
    lg: "sm:max-w-2xl",
    xl: "sm:max-w-6xl",
  };

  if (!mounted) return null;

  if (inlineMode) {
    if (!open) return null;
    return (
      <div
        ref={modalBodyRef}
        data-modal-form-root
        onKeyDownCapture={handleFormKeyNav}
        onChangeCapture={handleModalFieldChange}
        className={cn(
          "h-full min-h-0 w-full overflow-y-auto overscroll-contain",
          bodyClassName || "px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-5"
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
        hideCloseButton
        className={cn(
          "gap-0 p-0 overflow-hidden border border-[#d4d4d8] bg-[linear-gradient(168deg,rgba(255,255,255,0.99),rgba(244,244,245,0.97))] shadow-[0_32px_80px_-42px_rgba(42,6,8,0.35)]",
          sizes[size]
        )}
      >
        {!suppressHeader && (
          <DialogHeader className="relative sticky top-0 z-10 flex flex-row items-center gap-3 border-b border-[#e4e4e7] bg-[rgba(255,255,255,0.98)] px-4 py-3 backdrop-blur-sm sm:px-6 sm:py-4">
            {headerAccent && (
              <span aria-hidden className={cn("pointer-events-none absolute inset-x-0 top-0 h-[3px]", headerAccent)} />
            )}
            <DialogTitle asChild>
              <div className="min-w-0 flex-1 text-base font-semibold tracking-[0.01em] text-[#2A0608] sm:text-[1rem]">{title}</div>
            </DialogTitle>
            <DialogClose
              className={cn(
                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#d4d4d8] bg-white text-[#2A0608] shadow-sm",
                "hover:bg-[#f4f4f5] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              )}
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </DialogHeader>
        )}
        <div
          ref={modalBodyRef}
          data-modal-form-root
          onKeyDownCapture={handleFormKeyNav}
          onChangeCapture={handleModalFieldChange}
          className={cn(
            "modal-sheet-body touch-pan-y overflow-y-auto overscroll-contain",
            suppressHeader
              ? "max-h-[min(88dvh,100%)] px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-5"
              : "max-h-[min(calc(92dvh-4.5rem),100%)] px-4 py-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-h-[75vh] sm:px-6 sm:py-5",
            bodyClassName
          )}
        >
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { default as SelectField } from "@/components/ModalOptionSelect";
export type { ModalOptionSelectOption } from "@/components/ModalOptionSelect";

export function ModalStatusNotice({
  type,
  message,
}: {
  type: "success" | "error";
  message: string;
}) {
  const isSuccess = type === "success";
  const Icon = isSuccess ? CheckCircle2 : AlertTriangle;
  return (
    <div className="pointer-events-none fixed inset-0 z-[130] flex items-center justify-center px-4">
      <div
        className={cn(
          "flex max-w-sm flex-col items-center rounded-3xl border bg-white/95 px-8 py-7 text-center shadow-[0_24px_80px_-38px_rgba(15,23,42,0.45)] backdrop-blur-xl",
          isSuccess ? "border-emerald-200 text-emerald-800" : "border-red-200 text-red-800"
        )}
      >
        <div
          className={cn(
            "mb-4 flex h-16 w-16 items-center justify-center rounded-full border shadow-inner",
            isSuccess ? "border-emerald-200 bg-emerald-50 text-emerald-600" : "border-red-200 bg-red-50 text-red-600"
          )}
        >
          <Icon className="h-9 w-9" strokeWidth={1.8} />
        </div>
        <div className="text-lg font-semibold">{isSuccess ? "Saved" : "Not saved"}</div>
        <div className={cn("mt-1 text-sm", isSuccess ? "text-emerald-700" : "text-red-700")}>{message}</div>
      </div>
    </div>
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
// FORMAT HELPERS (re-exported from lib for backward compatibility)
// ============================================================
export { formatCurrency, formatDate, formatNumber } from "@/lib/format-helpers";

export { RowActionMenu } from "@/components/ui/RowActionMenu";
export { MobileDateInput } from "@/components/ui/MobileDateInput";
export { FormattedNumberInput, FormattedNumberEditable } from "@/components/ui/FormattedNumberInput";
export { ProcessingSpinner } from "@/components/ui/ProcessingLoader";
export { default as ProcessingLoader } from "@/components/ui/ProcessingLoader";
export { default as CuttingDiscSpinner, DEFAULT_CUTTING_DISC_SRC } from "@/components/ui/CuttingDiscSpinner";
export { Skeleton, SkeletonLine, TableSkeleton, PageSkeleton, ModalFormSkeleton } from "@/components/ui/skeleton";
