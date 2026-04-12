"use client";

import React, { useState, useEffect } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
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
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#9a7b5b]">Workspace</p>
        <h1 className="text-2xl font-bold text-[#241a13] tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[#7b6857]">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0 flex gap-2">{action}</div>}
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8b7763] leading-snug line-clamp-2">{title}</p>
            <p className={cn("text-sm sm:text-lg font-bold mt-1.5 leading-tight tabular-nums", c.valueTxt)}>{value}</p>
            {subtitle && <p className="mt-1.5 text-xs leading-snug text-[#8e7e71]">{subtitle}</p>}
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
  pagination?: {
    page: number;
    totalPages: number;
    total: number;
    onPageChange: (page: number) => void;
  };
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  loading,
  emptyMessage = "No data found",
  onRowClick,
  pagination,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className="rounded-[1.4rem] border border-white/70 bg-white/85 shadow-[0_26px_70px_-42px_rgba(51,42,33,0.35)] backdrop-blur-xl">
        <div className="overflow-visible">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#f8f1e7] hover:bg-[#f8f1e7]">
                {columns.map((col) => (
                  <TableHead key={col.key} className={cn("text-xs font-semibold text-gray-500 uppercase tracking-wider", col.className)}>
                    {col.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  {columns.map((col) => (
                    <TableCell key={col.key}>
                      <Skeleton className="h-4 w-3/4 rounded" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[1.4rem] border border-white/70 bg-white/85 shadow-[0_26px_70px_-42px_rgba(51,42,33,0.35)] backdrop-blur-xl">
      <div className="overflow-visible">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-[#efe2d3] bg-[#faf3ea]/90 hover:bg-[#faf3ea]/90">
              {columns.map((col) => (
                <TableHead key={col.key} className={cn("text-xs font-semibold text-gray-500 uppercase tracking-wider py-3", col.className)}>
                  {col.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl opacity-30">📋</span>
                    <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data.map((item, idx) => (
                <TableRow
                  key={idx}
                  onClick={() => onRowClick?.(item)}
                  className={cn(
                    "border-b border-[#f3e8db] transition-colors",
                    onRowClick ? "cursor-pointer hover:bg-[#fff4ea]" : "hover:bg-[#fcf6ef]"
                  )}
                >
                  {columns.map((col) => {
                    const isDate = !col.render && col.key.toLowerCase().includes("date") && typeof item[col.key] === "string" && item[col.key]?.match(/^\d{4}-\d{2}-\d{2}/);
                    return (
                      <TableCell key={col.key} className={cn("text-sm text-gray-700 py-3", isDate && "whitespace-nowrap", col.className)}>
                        {col.render
                          ? col.render(item)
                          : isDate
                          ? formatDate(item[col.key])
                          : item[col.key]}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-[#efe2d3] bg-[#fbf6ef]/80 px-4 py-3 text-sm">
          <p className="text-muted-foreground text-xs">
            Showing page <span className="font-medium text-gray-700">{pagination.page}</span> of <span className="font-medium text-gray-700">{pagination.totalPages}</span>
            <span className="text-gray-400 ml-1">· {pagination.total} total</span>
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="h-8 px-3 text-xs"
            >
              ← Prev
            </Button>
            <span className="px-2 py-1 text-xs text-gray-500 font-medium">
              {pagination.page} / {pagination.totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="h-8 px-3 text-xs"
            >
              Next →
            </Button>
          </div>
        </div>
      )}
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
  useEffect(() => setMounted(true), []);

  const handleFormKeyNav = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const container = event.currentTarget;
    const target = event.target as HTMLElement;

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
  if (!open) return null;

  if (inline) {
    return (
      <div className="h-[100dvh] w-full overflow-y-auto overscroll-contain p-2 sm:p-4">
        <div className={cn("relative mx-auto w-full bg-white rounded-xl sm:rounded-2xl shadow-2xl min-h-[calc(100dvh-1rem)] sm:min-h-0 sm:max-h-[calc(100dvh-2rem)] flex flex-col", sizes[size])}>
          {!hideHeader && (
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
              <h2 className="text-base font-semibold text-gray-900">{title}</h2>
              <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>
          )}
          <div onKeyDownCapture={handleFormKeyNav} className={cn("overflow-y-auto overscroll-contain flex-1", bodyClassName || "p-4 sm:p-6")}>{children}</div>
        </div>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("w-full gap-0 p-0 overflow-hidden", sizes[size])}>
        {!hideHeader && (
          <DialogHeader className="px-6 py-4 border-b border-border flex-shrink-0">
            <DialogTitle asChild><div className="text-base font-semibold text-gray-900">{title}</div></DialogTitle>
          </DialogHeader>
        )}
        <div onKeyDownCapture={handleFormKeyNav} className={cn("overflow-y-auto max-h-[75vh]", hideHeader ? "" : "px-6 py-5", bodyClassName)}>{children}</div>
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

export function formatDate(dateStr: string | Date | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return String(dateStr);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}
