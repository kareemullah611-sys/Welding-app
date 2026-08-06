"use client";
import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { apiCall } from "@/hooks/useApi";
import { formatDate, PaginationBar } from "@/components/ui";
import { formatCityPot, formatCityAmount } from "@/lib/city-money-format";
import { DEFAULT_LIST_PAGE_SIZE } from "@/lib/pagination";
import { cn } from "@/lib/utils";
import {
  Banknote,
  Receipt,
  Building2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

type Pot = Record<string, number> | undefined | null;

type Treasury = {
  cashInOffice?: Pot;
  chequesInHand?: Pot;
  bankBalance?: Pot;
  hasBankAccounts?: boolean;
  bankAccounts?: Array<{ id: number; bankName: string; accountNumber: string | null; balance: Pot }>;
};

type LedgerRow = {
  key: string;
  date: string;
  type: string;
  detail: string;
  reference: string | null;
  currencyCode: string;
  credit: number;
  debit: number;
  runningBalance?: number;
};

// Combine the currency-keyed pots into one net map.
function addPots(...pots: Pot[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pot of pots) {
    for (const [cc, amt] of Object.entries(pot || {})) {
      out[cc] = (out[cc] || 0) + Number(amt || 0);
    }
  }
  return out;
}

function hasMoney(pot: Pot): boolean {
  return Object.values(pot || {}).some((v) => Number(v) !== 0);
}

const LedgerTable = ({ rows, user }: { rows: LedgerRow[]; user: any }) => {
  if (rows.length === 0) {
    return <p className="px-4 py-3 text-sm text-gray-400">No movements yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
            <th className="px-3 py-2 font-medium">Date</th>
            <th className="px-3 py-2 font-medium">Particulars</th>
            <th className="px-3 py-2 text-right font-medium">In</th>
            <th className="px-3 py-2 text-right font-medium">Out</th>
            <th className="px-3 py-2 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-gray-100">
              <td className="whitespace-nowrap px-3 py-2 text-gray-500">{formatDate(r.date)}</td>
              <td className="px-3 py-2">
                <span className="font-medium text-gray-800">{r.type}</span>
                {r.detail ? <span className="text-gray-500"> — {r.detail}</span> : null}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                {r.credit ? formatCityAmount(user, r.credit, r.currencyCode) : ""}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-rose-700">
                {r.debit ? formatCityAmount(user, r.debit, r.currencyCode) : ""}
              </td>
              <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                {formatCityAmount(user, r.runningBalance ?? 0, r.currencyCode)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const BranchRow = ({
  icon: Icon,
  label,
  value,
  open,
  onToggle,
  children,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  open: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) => (
  <div className="border-t border-gray-100">
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50"
    >
      <div className="rounded-lg bg-gray-100 p-2 text-gray-600">
        <Icon className="h-4 w-4" />
      </div>
      <span className="text-sm font-medium text-gray-800">{label}</span>
      <span className="ml-auto text-sm font-semibold tabular-nums text-gray-900">{value}</span>
      <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? "" : "-rotate-90"}`} />
    </button>
    {open && <div className="bg-gray-50/60 pb-2">{children}</div>}
  </div>
);

export default function BalanceHub({ user, treasury, glass = true, netRevealed = true, onNetReveal }: { user: any; treasury: Treasury | null; glass?: boolean; netRevealed?: boolean; onNetReveal?: () => void }) {
  const isAfghanistan = user?.countryName === "Afghanistan";
  const cash = treasury?.cashInOffice;
  const cheques = treasury?.chequesInHand;
  const bank = treasury?.bankBalance;

  // Afghanistan cities only track cash; net excludes cheque/bank branches there.
  const net = isAfghanistan ? addPots(cash) : addPots(cash, cheques, bank);

  const [expanded, setExpanded] = useState(false);
  const [openBranch, setOpenBranch] = useState<"cash" | "cheques" | "bank" | null>(null);
  const [openAccountId, setOpenAccountId] = useState<number | null>(null);

  const [cashLedger, setCashLedger] = useState<LedgerRow[]>([]);
  const [cashLoading, setCashLoading] = useState(false);
  const [cashPage, setCashPage] = useState(1);
  const [cashTotal, setCashTotal] = useState(0);
  const [cashTotalPages, setCashTotalPages] = useState(1);
  const [accountLedger, setAccountLedger] = useState<Record<number, LedgerRow[]>>({});
  const [accountLoading, setAccountLoading] = useState(false);
  const [bankPage, setBankPage] = useState(1);
  const [bankTotal, setBankTotal] = useState(0);
  const [bankTotalPages, setBankTotalPages] = useState(1);

  const loadCashLedger = useCallback(async (page: number) => {
    setCashLoading(true);
    const r = await apiCall<{ ledger: LedgerRow[] }>("/api/v1/treasury/cash-ledger", {
      params: { page, limit: DEFAULT_LIST_PAGE_SIZE },
    });
    if (r.success && r.data) {
      setCashLedger(r.data.ledger || []);
      const p = r.pagination as { page?: number; total?: number; totalPages?: number } | undefined;
      setCashPage(p?.page || page);
      setCashTotal(p?.total ?? (r.data.ledger || []).length);
      setCashTotalPages(p?.totalPages || 1);
    } else {
      setCashLedger([]);
      setCashTotal(0);
      setCashTotalPages(1);
    }
    setCashLoading(false);
  }, []);

  useEffect(() => {
    if (openBranch === "cash") void loadCashLedger(cashPage);
  }, [openBranch, cashPage, loadCashLedger]);

  const loadAccountLedger = useCallback(async (id: number, page: number) => {
    setAccountLoading(true);
    const r = await apiCall<{ ledger: LedgerRow[] }>(`/api/v1/bank-accounts/${id}`, {
      params: { view: "ledger", page, limit: DEFAULT_LIST_PAGE_SIZE },
    });
    if (r.success && r.data) {
      setAccountLedger((prev) => ({
        ...prev,
        [id]: r.data!.ledger || [],
      }));
      const p = r.pagination as { page?: number; total?: number; totalPages?: number } | undefined;
      setBankPage(p?.page || page);
      setBankTotal(p?.total ?? (r.data!.ledger || []).length);
      setBankTotalPages(p?.totalPages || 1);
    } else {
      setAccountLedger((prev) => ({ ...prev, [id]: [] }));
      setBankTotal(0);
      setBankTotalPages(1);
    }
    setAccountLoading(false);
  }, []);

  useEffect(() => {
    if (openBranch === "bank" && openAccountId != null) void loadAccountLedger(openAccountId, bankPage);
  }, [openBranch, openAccountId, bankPage, loadAccountLedger]);

  const toggleBranch = (branch: "cash" | "cheques" | "bank") => {
    setOpenBranch((prev) => {
      if (prev === branch) return null;
      if (branch === "cash") setCashPage(1);
      if (branch === "bank") {
        setBankPage(1);
        setOpenAccountId(null);
      }
      return branch;
    });
  };

  const showCheques = !isAfghanistan && (treasury?.hasBankAccounts || hasMoney(cheques));
  const showBank = !isAfghanistan && treasury?.hasBankAccounts;

  return (
    <div
      className={cn(
        "overflow-hidden",
        glass
          ? "rounded-[1.5rem] border border-white/60 bg-white/40 backdrop-blur-2xl backdrop-saturate-[1.8] shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_24px_60px_-24px_rgba(42,6,8,0.28)]"
          : "rounded-2xl border border-gray-100 bg-white shadow-sm"
      )}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onNetReveal?.();
          setExpanded((v) => {
            if (v) {
              setOpenBranch(null);
              setOpenAccountId(null);
            }
            return !v;
          });
        }}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-gray-50/80"
        aria-expanded={expanded}
      >
        <div className="rounded-xl bg-gradient-to-br from-emerald-50 to-white p-2.5 text-emerald-600 shadow-sm">
          <Banknote className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Net Balance</p>
          <p className="text-xl font-bold tabular-nums text-emerald-700">{netRevealed ? formatCityPot(user, net) : "•••"}</p>
        </div>
        <ChevronDown
          className={`ml-auto h-5 w-5 text-gray-400 transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
      </button>

      {expanded && (
        <div>
          <BranchRow
            icon={Banknote}
            label="Cash in Office"
            value={formatCityPot(user, cash)}
            open={openBranch === "cash"}
            onToggle={() => toggleBranch("cash")}
          >
            {cashLoading ? (
              <p className="px-4 py-3 text-sm text-gray-400">Loading ledger…</p>
            ) : (
              <>
                <LedgerTable rows={cashLedger} user={user} />
                {cashTotal > 0 && (
                  <PaginationBar
                    bordered={false}
                    className="rounded-b-lg px-3"
                    pagination={{
                      page: cashPage,
                      totalPages: cashTotalPages,
                      total: cashTotal,
                      pageSize: DEFAULT_LIST_PAGE_SIZE,
                      onPageChange: setCashPage,
                    }}
                  />
                )}
              </>
            )}
          </BranchRow>

          {showCheques && (
            <BranchRow
              icon={Receipt}
              label="Cheques in Hand"
              value={formatCityPot(user, cheques)}
              open={openBranch === "cheques"}
              onToggle={() => toggleBranch("cheques")}
            >
              <div className="px-4 py-3">
                <p className="text-sm text-gray-600">
                  In-hand cheques total {formatCityPot(user, cheques)}.
                </p>
                <Link
                  href="/cheques"
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                >
                  Open Cheque Register <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            </BranchRow>
          )}

          {showBank && (
            <BranchRow
              icon={Building2}
              label="Bank Balance"
              value={formatCityPot(user, bank)}
              open={openBranch === "bank"}
              onToggle={() => toggleBranch("bank")}
            >
              <div className="space-y-1 px-2 py-1">
                {(treasury?.bankAccounts || []).map((acct) => (
                  <div key={acct.id} className="rounded-lg bg-white">
                    <button
                      type="button"
                      onClick={() => {
                        setOpenAccountId((prev) => {
                          const next = prev === acct.id ? null : acct.id;
                          if (next !== null) setBankPage(1);
                          return next;
                        });
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-gray-50"
                    >
                      <ChevronRight
                        className={`h-3.5 w-3.5 text-gray-400 transition-transform ${
                          openAccountId === acct.id ? "rotate-90" : ""
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-800">{acct.bankName}</p>
                        {acct.accountNumber && (
                          <p className="truncate text-xs text-gray-400">{acct.accountNumber}</p>
                        )}
                      </div>
                      <span className="ml-auto text-sm font-semibold tabular-nums text-blue-700">
                        {formatCityPot(user, acct.balance)}
                      </span>
                    </button>
                    {openAccountId === acct.id && (
                      <div className="border-t border-gray-100">
                        {accountLoading && !accountLedger[acct.id] ? (
                          <p className="px-4 py-3 text-sm text-gray-400">Loading ledger…</p>
                        ) : (
                          <>
                            <LedgerTable rows={accountLedger[acct.id] || []} user={user} />
                            {openAccountId === acct.id && bankTotal > 0 && (
                              <PaginationBar
                                bordered={false}
                                className="rounded-b-lg px-3"
                                pagination={{
                                  page: bankPage,
                                  totalPages: bankTotalPages,
                                  total: bankTotal,
                                  pageSize: DEFAULT_LIST_PAGE_SIZE,
                                  onPageChange: setBankPage,
                                }}
                              />
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {(treasury?.bankAccounts || []).length === 0 && (
                  <p className="px-3 py-2 text-sm text-gray-400">No bank accounts yet.</p>
                )}
              </div>
            </BranchRow>
          )}
        </div>
      )}
    </div>
  );
}
