"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { DataTable, Modal, PageHeader, formatDate, formatNumber } from "@/components/ui";
import Link from "next/link";

export default function SuperAdminPersonalExpensesPage() {
  const { user } = useAuth();
  const isSA = user?.role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showExpense, setShowExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expenseForm, setExpenseForm] = useState<any>({ expenseDate: new Date().toISOString().split("T")[0], detail: "", amount: 0, notes: "", bankAccountId: 0 });
  const [openActionId, setOpenActionId] = useState<number | null>(null);
  const [actionMenuDirection, setActionMenuDirection] = useState<"up" | "down">("down");

  const load = useCallback(async () => {
    if (!isSA) return;
    setLoading(true);
    const [accountsRes, expensesRes] = await Promise.all([
      apiCall("/api/v1/bank-accounts", { params: { scope: "super_admin" } }),
      apiCall("/api/v1/super-admin-personal-expenses", { params: { page, limit: 20 } }),
    ]);
    if (accountsRes.success) setAccounts(accountsRes.data as any[]);
    if (expensesRes.success) {
      setExpenses(expensesRes.data as any[]);
      setTotalPages((expensesRes.pagination as any)?.totalPages || 1);
      setTotal((expensesRes.pagination as any)?.total || 0);
    }
    setLoading(false);
  }, [isSA, page]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!openActionId) return;
    const handleOutside = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-action-menu-root='true']")) return;
      setOpenActionId(null);
    };
    document.addEventListener("pointerdown", handleOutside, true);
    return () => document.removeEventListener("pointerdown", handleOutside, true);
  }, [openActionId]);

  if (!isSA) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Only super admin can access this module.</div>;
  }

  const openNewExpense = () => {
    setEditingExpense(null);
    setExpenseForm({
      expenseDate: new Date().toISOString().split("T")[0],
      detail: "",
      amount: 0,
      notes: "",
      bankAccountId: accounts.find((a) => a.isActive)?.id || 0,
    });
    setError("");
    setShowExpense(true);
  };

  const openEditExpense = (expense: any) => {
    setEditingExpense(expense);
    setExpenseForm({
      expenseDate: expense.expenseDate,
      detail: expense.detail,
      amount: expense.amount,
      notes: expense.notes || "",
      bankAccountId: expense.bankAccountId,
    });
    setError("");
    setShowExpense(true);
  };

  const saveExpense = async (editing = false) => {
    if (!expenseForm.expenseDate || !expenseForm.detail.trim() || !expenseForm.amount || !expenseForm.bankAccountId) {
      setError("Date, detail, amount, and bank account are required");
      return;
    }
    setSubmitting(true);
    const endpoint = editing
      ? `/api/v1/super-admin-personal-expenses/${editingExpense.id}`
      : "/api/v1/super-admin-personal-expenses";
    const method = editing ? "PUT" : "POST";
    const body = editing
      ? { detail: expenseForm.detail, amount: Number(expenseForm.amount), notes: expenseForm.notes }
      : { ...expenseForm, amount: Number(expenseForm.amount) };
    const result = await apiCall(endpoint, { method, body });
    setSubmitting(false);
    if (result.success) {
      setShowExpense(false);
      setEditingExpense(null);
      load();
    } else {
      setError(result.error || "Failed");
    }
  };

  const deleteExpense = async (expense: any) => {
    if (!confirm(`Delete personal expense "${expense.detail}"?`)) return;
    await apiCall(`/api/v1/super-admin-personal-expenses/${expense.id}`, { method: "DELETE" });
    load();
  };

  return (
    <div>
      <PageHeader
        title="Super Admin Personal Expenses"
        subtitle="Record personal expenses from super admin bank accounts"
        action={
          <div className="flex gap-2">
            <button onClick={openNewExpense} className="btn-primary text-sm">+ Personal Expense</button>
          </div>
        }
      />

      <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-900">
        This module is separate from city expenses. It is only for super admin personal spending and only deducts from super admin bank accounts.
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="card">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Recorded Expenses</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{total}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Active Accounts</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{accounts.filter((a) => a.isActive).length}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Accounts in Use</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{accounts.filter((a) => (a.expenseCount || 0) > 0).length}</p>
        </div>
      </div>

      <div className="mb-6 rounded-2xl border border-amber-100 bg-amber-50/70 p-4 text-sm text-amber-900">
        Manage super admin bank accounts from{" "}
        <Link href="/settings/bank-accounts" className="font-semibold underline underline-offset-2">
          Bank Accounts
        </Link>.
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-gray-500">Personal Expense History</h2>
        <DataTable
          columns={[
            { key: "expenseDate", label: "Date", render: (e: any) => formatDate(e.expenseDate) },
            { key: "detail", label: "Detail" },
            { key: "bank", label: "Bank Account", render: (e: any) => <span>{e.bankAccount?.bankName} {e.bankAccount?.accountNumber ? `(${e.bankAccount.accountNumber})` : ""}</span> },
            { key: "amount", label: "Amount", render: (e: any) => <span className="font-medium text-red-600">{e.bankAccount?.currency?.symbol || e.bankAccount?.currency?.code} {formatNumber(e.amount)}</span> },
            { key: "notes", label: "Notes", render: (e: any) => e.notes || "—" },
            {
              key: "actions", label: "", render: (e: any) => (
                <div className="relative" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} data-action-menu-root="true">
                  <button
                    type="button"
                    onPointerDown={(event) => { event.stopPropagation(); }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setActionMenuDirection("down");
                      setOpenActionId((current) => current === e.id ? null : e.id);
                    }}
                    className="rounded-lg px-2 py-1 text-lg leading-none text-gray-600 hover:bg-gray-100"
                    aria-label="Open actions"
                  >
                    ⋯
                  </button>
                  {openActionId === e.id && (
                    <div className={`absolute right-0 z-50 w-40 rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg ${actionMenuDirection === "up" ? "bottom-full mb-1" : "top-full mt-1"}`}>
                      <button onClick={() => { setOpenActionId(null); openEditExpense(e); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-primary-700 hover:bg-primary-50">Edit</button>
                      <button onClick={() => { setOpenActionId(null); deleteExpense(e); }} className="w-full rounded-lg px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50">Delete</button>
                    </div>
                  )}
                </div>
              ),
            },
          ]}
          data={expenses}
          loading={loading}
          pagination={{ page, totalPages, total, onPageChange: setPage }}
        />
      </div>

      <Modal
        open={showExpense}
        onClose={() => { setShowExpense(false); setEditingExpense(null); }}
        title={editingExpense ? "Edit Personal Expense" : "Record Personal Expense"}
        size="md"
      >
        {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Date *</label>
            <input type="date" className="input-field" value={expenseForm.expenseDate} onChange={(e) => setExpenseForm((f: any) => ({ ...f, expenseDate: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Detail *</label>
            <input className="input-field" value={expenseForm.detail} onChange={(e) => setExpenseForm((f: any) => ({ ...f, detail: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Amount</label>
            <input type="number" className="input-field" value={expenseForm.amount || ""} onChange={(e) => setExpenseForm((f: any) => ({ ...f, amount: Number(e.target.value) || 0 }))} onWheel={e => e.currentTarget.blur()} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <input className="input-field" value={expenseForm.notes} onChange={(e) => setExpenseForm((f: any) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-3 border-t pt-4">
          <button onClick={() => saveExpense(Boolean(editingExpense))} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Save"}</button>
        </div>
      </Modal>
    </div>
  );
}
