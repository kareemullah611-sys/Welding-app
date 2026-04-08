"use client";
import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { apiCall } from "@/hooks/useApi";
import { DataTable, Modal, PageHeader, formatDate, formatNumber } from "@/components/ui";

export default function SuperAdminPersonalExpensesPage() {
  const { user } = useAuth();
  const isSA = user?.role === "super_admin";

  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [expenses, setExpenses] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [showAccount, setShowAccount] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [showEditExpense, setShowEditExpense] = useState(false);
  const [editingExpense, setEditingExpense] = useState<any>(null);
  const [editingAccount, setEditingAccount] = useState<any>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [accountForm, setAccountForm] = useState<any>({ bankName: "", accountNumber: "", currencyId: 0, isActive: true });
  const [expenseForm, setExpenseForm] = useState<any>({ expenseDate: new Date().toISOString().split("T")[0], detail: "", amount: 0, notes: "", bankAccountId: 0 });

  const load = useCallback(async () => {
    if (!isSA) return;
    setLoading(true);
    const [accountsRes, expensesRes, currenciesRes] = await Promise.all([
      apiCall("/api/v1/super-admin-bank-accounts"),
      apiCall("/api/v1/super-admin-personal-expenses", { params: { page, limit: 20 } }),
      apiCall("/api/v1/currencies"),
    ]);
    if (accountsRes.success) setAccounts(accountsRes.data as any[]);
    if (expensesRes.success) {
      setExpenses(expensesRes.data as any[]);
      setTotalPages((expensesRes.pagination as any)?.totalPages || 1);
      setTotal((expensesRes.pagination as any)?.total || 0);
    }
    if (currenciesRes.success) setCurrencies(currenciesRes.data as any[]);
    setLoading(false);
  }, [isSA, page]);

  useEffect(() => { load(); }, [load]);

  if (!isSA) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Only super admin can access this module.</div>;
  }

  const openNewAccount = () => {
    setEditingAccount(null);
    setAccountForm({ bankName: "", accountNumber: "", currencyId: currencies[0]?.id || 0, isActive: true });
    setError("");
    setShowAccount(true);
  };

  const openEditAccount = (account: any) => {
    setEditingAccount(account);
    setAccountForm({
      bankName: account.bankName,
      accountNumber: account.accountNumber || "",
      currencyId: account.currencyId,
      isActive: account.isActive,
    });
    setError("");
    setShowAccount(true);
  };

  const saveAccount = async () => {
    if (!accountForm.bankName.trim() || !accountForm.currencyId) {
      setError("Bank name and currency are required");
      return;
    }
    setSubmitting(true);
    const endpoint = editingAccount
      ? `/api/v1/super-admin-bank-accounts/${editingAccount.id}`
      : "/api/v1/super-admin-bank-accounts";
    const method = editingAccount ? "PATCH" : "POST";
    const result = await apiCall(endpoint, { method, body: accountForm });
    setSubmitting(false);
    if (result.success) {
      setShowAccount(false);
      load();
    } else {
      setError(result.error || "Failed");
    }
  };

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
    setShowEditExpense(true);
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
      setShowEditExpense(false);
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

  const toggleAccount = async (account: any) => {
    await apiCall(`/api/v1/super-admin-bank-accounts/${account.id}`, {
      method: "PATCH",
      body: { isActive: !account.isActive, bankName: account.bankName, accountNumber: account.accountNumber, currencyId: account.currencyId },
    });
    load();
  };

  return (
    <div>
      <PageHeader
        title="Super Admin Personal Expenses"
        subtitle="Record personal expenses from super admin bank accounts"
        action={
          <div className="flex gap-2">
            <button onClick={openNewAccount} className="btn-secondary text-sm">+ Bank Account</button>
            <button onClick={openNewExpense} className="btn-primary text-sm">+ Personal Expense</button>
          </div>
        }
      />

      <div className="mb-6 rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-900">
        This module is separate from city expenses. It is only for super admin personal spending and only deducts from super admin bank accounts.
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="card">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Active Accounts</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{accounts.filter((a) => a.isActive).length}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Recorded Expenses</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{total}</p>
        </div>
        <div className="card">
          <p className="text-xs uppercase tracking-[0.18em] text-gray-500">Accounts in Use</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{accounts.filter((a) => (a.expenseCount || 0) > 0).length}</p>
        </div>
      </div>

      <div className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.16em] text-gray-500">Super Admin Bank Accounts</h2>
        <DataTable
          columns={[
            { key: "bankName", label: "Bank", render: (a: any) => <span className="font-medium">{a.bankName}</span> },
            { key: "accountNumber", label: "Account Number", render: (a: any) => a.accountNumber || "—" },
            { key: "currency", label: "Currency", render: (a: any) => `${a.currency?.code || ""} ${a.currency?.symbol || ""}`.trim() },
            { key: "expenseCount", label: "Usage", render: (a: any) => `${a.expenseCount || 0} expenses` },
            { key: "status", label: "Status", render: (a: any) => <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${a.isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{a.isActive ? "Active" : "Inactive"}</span> },
            {
              key: "actions", label: "", render: (a: any) => (
                <div className="flex gap-2">
                  <button onClick={() => openEditAccount(a)} className="text-xs text-primary-600 hover:underline">Edit</button>
                  <button onClick={() => toggleAccount(a)} className="text-xs text-gray-600 hover:underline">{a.isActive ? "Deactivate" : "Reactivate"}</button>
                </div>
              ),
            },
          ]}
          data={accounts}
          loading={loading}
        />
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
                <div className="flex gap-2">
                  <button onClick={() => openEditExpense(e)} className="text-xs text-primary-600 hover:underline">Edit</button>
                  <button onClick={() => deleteExpense(e)} className="text-xs text-red-600 hover:underline">Delete</button>
                </div>
              ),
            },
          ]}
          data={expenses}
          loading={loading}
          pagination={{ page, totalPages, total, onPageChange: setPage }}
        />
      </div>

      <Modal open={showAccount} onClose={() => setShowAccount(false)} title={editingAccount ? `Edit — ${editingAccount.bankName}` : "New Super Admin Bank Account"} size="sm">
        {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Bank Name *</label>
            <input className="input-field" value={accountForm.bankName} onChange={(e) => setAccountForm((f: any) => ({ ...f, bankName: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Account Number</label>
            <input className="input-field" value={accountForm.accountNumber} onChange={(e) => setAccountForm((f: any) => ({ ...f, accountNumber: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Currency *</label>
            <select className="select-field" value={accountForm.currencyId} onChange={(e) => setAccountForm((f: any) => ({ ...f, currencyId: Number(e.target.value) }))}>
              <option value={0}>Select currency…</option>
              {currencies.map((c: any) => <option key={c.id} value={c.id}>{c.code} {c.symbol}</option>)}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-3 border-t pt-4">
          <button onClick={() => setShowAccount(false)} className="btn-secondary text-sm">Cancel</button>
          <button onClick={saveAccount} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Save"}</button>
        </div>
      </Modal>

      <Modal open={showExpense} onClose={() => setShowExpense(false)} title="Record Personal Expense" size="md">
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
            <label className="mb-1 block text-sm font-medium text-gray-700">Amount *</label>
            <input type="number" className="input-field" value={expenseForm.amount || ""} onChange={(e) => setExpenseForm((f: any) => ({ ...f, amount: Number(e.target.value) || 0 }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Bank Account *</label>
            <select className="select-field" value={expenseForm.bankAccountId} onChange={(e) => setExpenseForm((f: any) => ({ ...f, bankAccountId: Number(e.target.value) }))}>
              <option value={0}>Select bank account…</option>
              {accounts.filter((a) => a.isActive).map((a) => (
                <option key={a.id} value={a.id}>{a.bankName}{a.accountNumber ? ` (${a.accountNumber})` : ""} · {a.currency?.code}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <input className="input-field" value={expenseForm.notes} onChange={(e) => setExpenseForm((f: any) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-3 border-t pt-4">
          <button onClick={() => setShowExpense(false)} className="btn-secondary text-sm">Cancel</button>
          <button onClick={() => saveExpense(false)} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Record Expense"}</button>
        </div>
      </Modal>

      <Modal open={showEditExpense} onClose={() => setShowEditExpense(false)} title={`Edit — ${editingExpense?.detail || "Expense"}`} size="sm">
        {error && <div className="mb-3 rounded border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</div>}
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Detail *</label>
            <input className="input-field" value={expenseForm.detail} onChange={(e) => setExpenseForm((f: any) => ({ ...f, detail: e.target.value }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Amount *</label>
            <input type="number" className="input-field" value={expenseForm.amount || ""} onChange={(e) => setExpenseForm((f: any) => ({ ...f, amount: Number(e.target.value) || 0 }))} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Notes</label>
            <input className="input-field" value={expenseForm.notes} onChange={(e) => setExpenseForm((f: any) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-3 border-t pt-4">
          <button onClick={() => setShowEditExpense(false)} className="btn-secondary text-sm">Cancel</button>
          <button onClick={() => saveExpense(true)} disabled={submitting} className="btn-primary text-sm">{submitting ? "..." : "Save"}</button>
        </div>
      </Modal>
    </div>
  );
}
