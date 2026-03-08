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
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6 pb-4 border-b border-gray-100">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0 flex gap-2">{action}</div>}
    </div>
  );
}

// ============================================================
// STATS CARD
// ============================================================
const colorMap = {
  blue:   { iconBg: "bg-blue-100",   iconText: "text-blue-600",   accent: "border-l-blue-500",   valueTxt: "text-blue-700" },
  green:  { iconBg: "bg-green-100",  iconText: "text-green-600",  accent: "border-l-green-500",  valueTxt: "text-green-700" },
  red:    { iconBg: "bg-red-100",    iconText: "text-red-600",    accent: "border-l-red-500",    valueTxt: "text-red-700" },
  yellow: { iconBg: "bg-yellow-100", iconText: "text-yellow-600", accent: "border-l-yellow-500", valueTxt: "text-yellow-700" },
  purple: { iconBg: "bg-purple-100", iconText: "text-purple-600", accent: "border-l-purple-500", valueTxt: "text-purple-700" },
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
    <Card className={cn("shadow-sm hover:shadow-md transition-all duration-200 border-l-4", c.accent)}>
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide leading-snug line-clamp-2">{title}</p>
            <p className={cn("text-base sm:text-xl font-bold mt-1.5 leading-tight tabular-nums break-all", c.valueTxt)}>{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1.5 leading-snug">{subtitle}</p>}
          </div>
          {icon && (
            <div className={cn("w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0", c.iconBg, c.iconText)}>
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
      <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50 hover:bg-gray-50">
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
    );
  }

  return (
    <div className="rounded-xl border border-border bg-white shadow-sm overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="bg-gray-50/80 hover:bg-gray-50/80 border-b border-gray-100">
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
                    "border-b border-gray-50 transition-colors",
                    onRowClick ? "cursor-pointer hover:bg-primary-50/50" : "hover:bg-gray-50/50"
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
      {pagination && pagination.totalPages > 1 && (
        <div className="px-4 py-3 border-t border-border flex items-center justify-between text-sm bg-gray-50/50">
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
      <DialogContent className={cn("w-full gap-0 p-0 overflow-hidden", sizes[size])}>
        <DialogHeader className="px-6 py-4 border-b border-border flex-shrink-0">
          <DialogTitle asChild><div className="text-base font-semibold text-gray-900">{title}</div></DialogTitle>
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
  return `${symbol} ${amount.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined || isNaN(num as number)) return "0";
  return (num as number).toLocaleString("en-PK");
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return String(date);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}
