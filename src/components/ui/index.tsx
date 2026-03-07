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
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
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
  blue:   { bg: "bg-blue-50",   text: "text-blue-600",   border: "border-blue-100" },
  green:  { bg: "bg-green-50",  text: "text-green-600",  border: "border-green-100" },
  red:    { bg: "bg-red-50",    text: "text-red-600",    border: "border-red-100" },
  yellow: { bg: "bg-yellow-50", text: "text-yellow-600", border: "border-yellow-100" },
  purple: { bg: "bg-purple-50", text: "text-purple-600", border: "border-purple-100" },
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
    <Card className="shadow-sm hover:shadow-md transition-shadow duration-150">
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground font-medium leading-snug">{title}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1 leading-tight">{value}</p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          {icon && (
            <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0 ml-3 border", c.bg, c.border)}>
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
    <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
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
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-14 text-center text-muted-foreground text-sm">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              data.map((item, idx) => (
                <TableRow
                  key={idx}
                  onClick={() => onRowClick?.(item)}
                  className={cn("transition-colors", onRowClick && "cursor-pointer hover:bg-blue-50/40")}
                >
                  {columns.map((col) => (
                    <TableCell key={col.key} className={cn("text-sm text-gray-700", col.className)}>
                      {col.render
                        ? col.render(item)
                        : col.key.toLowerCase().includes("date") &&
                          typeof item[col.key] === "string" &&
                          item[col.key]?.match(/^\d{4}-\d{2}-\d{2}/)
                        ? formatDate(item[col.key])
                        : item[col.key]}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pagination && pagination.totalPages > 1 && (
        <div className="px-4 py-3 border-t border-border flex items-center justify-between text-sm bg-gray-50/50">
          <p className="text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages}{" "}
            <span className="text-gray-400">({pagination.total} total)</span>
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              Next
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
          <DialogTitle className="text-base font-semibold text-gray-900">{title}</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto px-6 py-5 max-h-[75vh]">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// STATUS BADGE
// ============================================================
const badgeStyles: Record<string, string> = {
  active:       "bg-green-100 text-green-800 border-green-200 hover:bg-green-100",
  cancelled:    "bg-red-100 text-red-800 border-red-200 hover:bg-red-100",
  marked_short: "bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100",
  ongoing:      "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100",
  completed:    "bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-100",
};

export function StatusBadge({ status }: { status: string }) {
  if (!status) return <span className="text-xs text-muted-foreground">-</span>;
  const cls = badgeStyles[status] ?? "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100";
  const label = status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <Badge variant="outline" className={cn("text-xs font-medium", cls)}>
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
