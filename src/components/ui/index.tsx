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
    <div className="mb-6 overflow-hidden rounded-[1.1rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(25,26,27,0.96),rgba(15,16,17,0.92))] px-5 py-5 shadow-[0_24px_70px_-42px_rgba(0,0,0,0.82)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="mb-2 text-[11px] font-[590] uppercase tracking-[0.22em] text-[#62666d]">Workspace</p>
        <h1 className="text-2xl font-[510] text-[#f7f8f8] tracking-[-0.04em] sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[#8a8f98]">{subtitle}</p>}
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
  blue:   { iconBg: "bg-[#5e6ad2]/12", iconText: "text-[#aab1ff]", accent: "from-[#17181d] to-[#101113]", valueTxt: "text-[#f7f8f8]", ring: "ring-white/[0.08]" },
  green:  { iconBg: "bg-emerald-500/12", iconText: "text-emerald-300", accent: "from-[#17181d] to-[#101113]", valueTxt: "text-[#f7f8f8]", ring: "ring-white/[0.08]" },
  red:    { iconBg: "bg-red-500/12", iconText: "text-red-300", accent: "from-[#17181d] to-[#101113]", valueTxt: "text-[#f7f8f8]", ring: "ring-white/[0.08]" },
  yellow: { iconBg: "bg-yellow-500/12", iconText: "text-yellow-300", accent: "from-[#17181d] to-[#101113]", valueTxt: "text-[#f7f8f8]", ring: "ring-white/[0.08]" },
  purple: { iconBg: "bg-[#7170ff]/12", iconText: "text-[#c6c8ff]", accent: "from-[#17181d] to-[#101113]", valueTxt: "text-[#f7f8f8]", ring: "ring-white/[0.08]" },
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
            <p className="text-[11px] font-[590] uppercase tracking-[0.18em] text-[#62666d] leading-snug line-clamp-2">{title}</p>
            <p className={cn("text-sm sm:text-lg font-bold mt-1.5 leading-tight tabular-nums", c.valueTxt)}>{value}</p>
            {subtitle && <p className="mt-1.5 text-xs leading-snug text-[#8a8f98]">{subtitle}</p>}
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
      <div className="overflow-hidden rounded-[1rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(25,26,27,0.98),rgba(15,16,17,0.94))] shadow-[0_24px_60px_-34px_rgba(0,0,0,0.78)] backdrop-blur-xl">
        <Table>
          <TableHeader>
            <TableRow className="bg-white/[0.02] hover:bg-white/[0.02]">
              {columns.map((col) => (
                <TableHead key={col.key} className={cn("text-xs font-[590] text-[#62666d] uppercase tracking-[0.16em]", col.className)}>
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
    );
  }

  return (
    <div className="overflow-x-auto rounded-[1rem] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(25,26,27,0.98),rgba(15,16,17,0.94))] shadow-[0_24px_60px_-34px_rgba(0,0,0,0.78)] backdrop-blur-xl">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.02]">
              {columns.map((col) => (
                <TableHead key={col.key} className={cn("py-3 text-xs font-[590] text-[#62666d] uppercase tracking-[0.16em]", col.className)}>
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
                    <p className="text-sm text-[#8a8f98]">{emptyMessage}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              data.map((item, idx) => (
                <TableRow
                  key={idx}
                  onClick={() => onRowClick?.(item)}
                  className={cn(
                    "border-b border-white/[0.05] transition-colors",
                    onRowClick ? "cursor-pointer hover:bg-white/[0.03]" : "hover:bg-white/[0.02]"
                  )}
                >
                  {columns.map((col) => {
                    const isDate = !col.render && col.key.toLowerCase().includes("date") && typeof item[col.key] === "string" && item[col.key]?.match(/^\d{4}-\d{2}-\d{2}/);
                    return (
                      <TableCell key={col.key} className={cn("py-3 text-sm text-[#d0d6e0]", isDate && "whitespace-nowrap", col.className)}>
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
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm">
          <p className="text-xs text-[#8a8f98]">
            Showing page <span className="font-[510] text-[#f7f8f8]">{pagination.page}</span> of <span className="font-[510] text-[#f7f8f8]">{pagination.totalPages}</span>
            <span className="ml-1 text-[#62666d]">· {pagination.total} total</span>
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
            <span className="px-2 py-1 text-xs font-[510] text-[#8a8f98]">
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
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const sizes = {
    sm: "sm:max-w-md",
    md: "sm:max-w-lg",
    lg: "sm:max-w-2xl",
    xl: "sm:max-w-4xl",
  };

  if (!mounted) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn("w-full gap-0 overflow-hidden border border-white/[0.08] bg-[linear-gradient(180deg,rgba(25,26,27,0.98),rgba(15,16,17,0.96))] p-0 shadow-[0_32px_90px_-34px_rgba(0,0,0,0.88)]", sizes[size])}>
        <DialogHeader className="border-b border-white/[0.06] px-6 py-4 flex-shrink-0">
          <DialogTitle asChild><div className="text-base font-[590] text-[#f7f8f8]">{title}</div></DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto px-6 py-5 max-h-[75vh]">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// STATUS BADGE
// ============================================================
const badgeConfig: Record<string, { cls: string; dot: string }> = {
  active:       { cls: "bg-emerald-500/12 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/12", dot: "bg-emerald-400" },
  cancelled:    { cls: "bg-red-500/12 text-red-300 border-red-500/20 hover:bg-red-500/12", dot: "bg-red-400" },
  marked_short: { cls: "bg-yellow-500/12 text-yellow-300 border-yellow-500/20 hover:bg-yellow-500/12", dot: "bg-yellow-400" },
  ongoing:      { cls: "bg-[#7170ff]/12 text-[#c6c8ff] border-[#7170ff]/20 hover:bg-[#7170ff]/12", dot: "bg-[#828fff]" },
  completed:    { cls: "bg-white/[0.05] text-[#d0d6e0] border-white/[0.08] hover:bg-white/[0.05]", dot: "bg-[#8a8f98]" },
  paid:         { cls: "bg-emerald-500/12 text-emerald-300 border-emerald-500/20 hover:bg-emerald-500/12", dot: "bg-emerald-400" },
  pending:      { cls: "bg-yellow-500/12 text-yellow-300 border-yellow-500/20 hover:bg-yellow-500/12", dot: "bg-yellow-400" },
  partial:      { cls: "bg-orange-500/12 text-orange-300 border-orange-500/20 hover:bg-orange-500/12", dot: "bg-orange-400" },
};

export function StatusBadge({ status }: { status: string }) {
  if (!status) return <span className="text-xs text-[#8a8f98]">—</span>;
  const config = badgeConfig[status] ?? { cls: "bg-[#7170ff]/12 text-[#c6c8ff] border-[#7170ff]/20 hover:bg-[#7170ff]/12", dot: "bg-[#828fff]" };
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
