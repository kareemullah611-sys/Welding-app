"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useRouter } from "next/navigation";
import { apiCall } from "@/hooks/useApi";
import { useOffline } from "@/hooks/useOffline";
import { formatNumber, RowActionMenu } from "@/components/ui";
import { ChevronRight, Users, Search, Plus } from "lucide-react";
import { readOfflineReadSnapshot, writeOfflineReadSnapshot } from "@/lib/offline-read-snapshot";
import { getPendingInvestors } from "@/lib/offline-queue-overlays";
import { pruneStalePendingRows } from "@/lib/offline-pending-prune";

const INVESTORS_READ_CACHE_KEY = "mrf-investors-read-cache-v1";

type InvestorsReadSnapshot = {
  investors: Investor[];
};

type Investor = { id: number | string; name: string; relationship?: string; phone?: string; accounts: any[] };
const isPendingInvestor = (inv: Investor) => typeof inv?.id === "string" && inv.id.startsWith("pending-");

function applyQueuedMutationsToInvestors(baseRows: Investor[], queueItems: any[]) {
  if (!Array.isArray(baseRows) || !Array.isArray(queueItems) || queueItems.length === 0) return baseRows;
  let next = [...baseRows];
  for (const q of queueItems) {
    const method = String(q?.method || "").toUpperCase();
    if (!["PUT", "PATCH", "DELETE"].includes(method)) continue;
    const url = String(q?.url || "");
    if (!url.startsWith("/api/v1/investors/")) continue;
    const match = url.match(/^\/api\/v1\/investors\/([^/?#]+)/);
    const investorId = match?.[1];
    if (!investorId) continue;
    if (method === "DELETE") {
      next = next.filter((row) => String(row?.id || "") !== investorId);
      continue;
    }
    let patch: any = {};
    try {
      patch = JSON.parse(String(q?.body || "{}"));
    } catch {
      patch = {};
    }
    next = next.map((row) =>
      String(row?.id || "") === investorId
        ? {
            ...row,
            name: patch?.name ?? row?.name,
            relationship: patch?.relationship ?? row?.relationship,
            phone: patch?.phone ?? row?.phone,
            _pending: true,
          }
        : row
    );
  }
  return next;
}

export default function InvestorsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { isOnline, queuedItems, updateQueuedItem, discardQueuedItem } = useOffline();
  const [investors, setInvestors] = useState<Investor[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showOfflineSnapshot, setShowOfflineSnapshot] = useState(false);
  const [attributionYear, setAttributionYear] = useState(new Date().getFullYear());
  const [attributionPreview, setAttributionPreview] = useState<any>(null);
  const [attributionLoading, setAttributionLoading] = useState(false);
  const [attributionError, setAttributionError] = useState("");
  const [finalizationSaving, setFinalizationSaving] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [superAdminAccounts, setSuperAdminAccounts] = useState<any[]>([]);
  const [participantForm, setParticipantForm] = useState({
    name: "",
    type: "investor",
    effectiveDate: new Date().toISOString().split("T")[0],
    initialCapitalPkr: "",
    investorProfitSharePercent: "50",
    managerProfitSharePercent: "50",
    remarks: "",
  });
  const [capitalEventForm, setCapitalEventForm] = useState({
    participantId: "",
    eventType: "capital_contribution",
    amountPkr: "",
    effectiveDate: new Date().toISOString().split("T")[0],
    investorProfitSharePercent: "",
    managerProfitSharePercent: "",
    reference: "",
    remarks: "",
  });
  const [shareEventForm, setShareEventForm] = useState({
    participantId: "",
    effectiveDate: new Date().toISOString().split("T")[0],
    investorProfitSharePercent: "50",
    managerProfitSharePercent: "50",
    reference: "",
    remarks: "",
  });
  const [participantActionForm, setParticipantActionForm] = useState({
    participantId: "",
    actionType: "profit_withdrawal",
    profitAmountPkr: "",
    capitalAmountPkr: "",
    effectiveDate: new Date().toISOString().split("T")[0],
    reference: "",
    remarks: "",
  });
  const [settlementForm, setSettlementForm] = useState({
    participantId: "",
    actionId: "",
    currencyId: "",
    settlementAmount: "",
    exchangeRate: "",
    profitComponentPkr: "",
    capitalComponentPkr: "",
    paymentDate: new Date().toISOString().split("T")[0],
    paymentReference: "",
    paymentMethod: "",
    bankCashAccount: "",
  });
  const [settlementPaymentForm, setSettlementPaymentForm] = useState({
    settlementId: "",
    actionId: "",
    participantId: "",
    superAdminBankAccountId: "",
    currencyId: "",
    paymentAmount: "",
    exchangeRate: "",
    paymentDate: new Date().toISOString().split("T")[0],
    paymentReference: "",
    paymentMethod: "",
    remarks: "",
  });
  const [participantSaving, setParticipantSaving] = useState(false);
  const [participantError, setParticipantError] = useState("");

  // Create investor
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: "", relationship: "", phone: "", notes: "",
    startDate: new Date().toISOString().split("T")[0],
    initialDeposit: "",
  });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // Edit investor
  const [editTarget, setEditTarget] = useState<Investor | null>(null);
  const [editForm, setEditForm] = useState({ name: "", relationship: "", phone: "" });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  // Delete investor
  const [deleteTarget, setDeleteTarget] = useState<Investor | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [openActionId, setOpenActionId] = useState<number | string | null>(null);

  useEffect(() => {
    if (user && user.role !== "super_admin") router.replace("/dashboard");
  }, [user, router]);

  const readSnapshot = useCallback(() => {
    return readOfflineReadSnapshot<InvestorsReadSnapshot>(INVESTORS_READ_CACHE_KEY);
  }, []);

  const writeSnapshot = useCallback((investorsData: Investor[]) => {
    writeOfflineReadSnapshot<InvestorsReadSnapshot>(INVESTORS_READ_CACHE_KEY, { investors: investorsData });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const invRes = await apiCall("/api/v1/investors", { params: { limit: 200 } });
    if (invRes.success) {
      let loaded = [...getPendingInvestors(queuedItems as any), ...((invRes.data as Investor[]) || [])];
      loaded = applyQueuedMutationsToInvestors(loaded, queuedItems as any);
      setInvestors(loaded);
      writeSnapshot(loaded);
      setShowOfflineSnapshot(false);
    } else if (!isOnline) {
      const snapshot = readSnapshot()?.data;
      if (snapshot?.investors?.length) {
        const cleanedInvestors = pruneStalePendingRows(snapshot.investors as any[], queuedItems as any[], "/investors");
        const mergedSnapshotInvestors = applyQueuedMutationsToInvestors(cleanedInvestors as Investor[], queuedItems as any);
        setInvestors(mergedSnapshotInvestors);
        setShowOfflineSnapshot(true);
      }
    }
    setLoading(false);
  }, [isOnline, queuedItems, readSnapshot, writeSnapshot]);

  useEffect(() => { load(); }, [load]);

  const loadParticipants = useCallback(async () => {
    const res = await apiCall("/api/v1/investment-participants");
    if (res.success) setParticipants((res.data as any[]) || []);
  }, []);

  useEffect(() => { if (user?.role === "super_admin" && isOnline) loadParticipants(); }, [user?.role, isOnline, loadParticipants]);

  const loadCurrencies = useCallback(async () => {
    const res = await apiCall("/api/v1/currencies");
    if (res.success) setCurrencies((res.data as any[]) || []);
  }, []);

  useEffect(() => { if (user?.role === "super_admin" && isOnline) loadCurrencies(); }, [user?.role, isOnline, loadCurrencies]);

  const loadSuperAdminAccounts = useCallback(async () => {
    const res = await apiCall("/api/v1/bank-accounts", { params: { scope: "super_admin" } });
    if (res.success) setSuperAdminAccounts((res.data as any[]) || []);
  }, []);

  useEffect(() => { if (user?.role === "super_admin" && isOnline) loadSuperAdminAccounts(); }, [user?.role, isOnline, loadSuperAdminAccounts]);

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

  const openCreate = () => {
    setCreateForm({
      name: "", relationship: "", phone: "", notes: "",
      startDate: new Date().toISOString().split("T")[0],
      initialDeposit: "",
    });
    setCreateError("");
    setShowCreate(true);
  };

  const handleCreate = async () => {
    if (!createForm.name.trim()) { setCreateError("Name is required"); return; }
    if (!createForm.startDate) { setCreateError("Start date is required"); return; }
    setCreating(true); setCreateError("");
    const r = await apiCall("/api/v1/investors", { method: "POST", body: createForm });
    setCreating(false);
    if ((r as any).success === false) { setCreateError((r as any).error || "Failed to create investor"); return; }
    setShowCreate(false);
    load();
  };

  const openEdit = (inv: Investor) => {
    setEditTarget(inv);
    setEditForm({ name: inv.name, relationship: inv.relationship ?? "", phone: inv.phone ?? "" });
    setEditError("");
  };

  const handleEditSave = async () => {
    if (!editTarget || !editForm.name.trim()) { setEditError("Name is required"); return; }
    if (typeof editTarget.id === "string" && editTarget.id.startsWith("pending-")) {
      const queueId = editTarget.id.replace("pending-", "");
      const ok = await updateQueuedItem(queueId, {
        body: JSON.stringify({
          name: editForm.name.trim(),
          relationship: editForm.relationship.trim() || null,
          phone: editForm.phone.trim() || null,
        }),
      });
      if (!ok) { setEditError("Unable to update pending entry"); return; }
      const nextRows = investors.map((row) =>
        row.id === editTarget.id
          ? {
              ...row,
              name: editForm.name.trim(),
              relationship: editForm.relationship.trim() || undefined,
              phone: editForm.phone.trim() || undefined,
            }
          : row
      );
      setInvestors(nextRows);
      writeSnapshot(nextRows);
      setEditTarget(null);
      return;
    }
    setEditSaving(true); setEditError("");
    const res = await apiCall(`/api/v1/investors/${editTarget.id}`, {
      method: "PATCH",
      body: { name: editForm.name.trim(), relationship: editForm.relationship.trim() || null, phone: editForm.phone.trim() || null },
    });
    setEditSaving(false);
    if ((res as any).success === false) { setEditError((res as any).error || "Failed to save"); return; }
    setEditTarget(null);
    load();
  };

  const openDelete = (inv: Investor) => {
    setDeleteTarget(inv);
    setDeleteError("");
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (typeof deleteTarget.id === "string" && deleteTarget.id.startsWith("pending-")) {
      const queueId = deleteTarget.id.replace("pending-", "");
      const ok = await discardQueuedItem(queueId);
      if (!ok) { setDeleteError("Unable to delete pending entry"); return; }
      const nextRows = investors.filter((row) => row.id !== deleteTarget.id);
      setInvestors(nextRows);
      writeSnapshot(nextRows);
      setDeleteTarget(null);
      return;
    }
    setDeleting(true); setDeleteError("");
    const res = await apiCall(`/api/v1/investors/${deleteTarget.id}`, { method: "DELETE" });
    setDeleting(false);
    if ((res as any).success === false) { setDeleteError((res as any).error || "Failed to delete"); return; }
    setDeleteTarget(null);
    load();
  };

  const loadAttributionPreview = async () => {
    setAttributionLoading(true);
    setAttributionError("");
    const res = await apiCall("/api/v1/investor-attribution", { params: { year: attributionYear } });
    setAttributionLoading(false);
    if ((res as any).success === false) {
      setAttributionError((res as any).error || "Failed to load attribution preview");
      return;
    }
    setAttributionPreview(res.data);
  };

  const finalizeAttributionPeriod = async () => {
    if (!attributionPreview?.finalizationDryRun) return;
    const confirmation = window.prompt("Type FINALIZE to confirm investor attribution finalization. This freezes ownership only and creates no cash/bank distributions.");
    if (confirmation !== "FINALIZE") return;
    setFinalizationSaving(true);
    setAttributionError("");
    const res = await apiCall("/api/v1/investor-attribution", {
      method: "POST",
      body: {
        action: "finalize",
        year: attributionYear,
        confirmation,
      },
    });
    setFinalizationSaving(false);
    if ((res as any).success === false) {
      setAttributionError((res as any).error?.message || (res as any).error || "Failed to finalize investor attribution period");
      return;
    }
    await loadAttributionPreview();
  };

  const saveParticipant = async () => {
    setParticipantSaving(true);
    setParticipantError("");
    const body = {
      ...participantForm,
      investorProfitSharePercent: participantForm.type === "manager" ? 100 : Number(participantForm.investorProfitSharePercent),
      managerProfitSharePercent: participantForm.type === "manager" ? 0 : Number(participantForm.managerProfitSharePercent),
      initialCapitalPkr: Number(participantForm.initialCapitalPkr || 0),
    };
    const res = await apiCall("/api/v1/investment-participants", { method: "POST", body });
    setParticipantSaving(false);
    if ((res as any).success === false) {
      setParticipantError((res as any).error || "Failed to save participant");
      return;
    }
    setParticipantForm((prev) => ({ ...prev, name: "", initialCapitalPkr: "", remarks: "" }));
    await loadParticipants();
  };

  const saveCapitalEvent = async () => {
    if (!capitalEventForm.participantId) { setParticipantError("Select a participant for the capital event"); return; }
    setParticipantSaving(true);
    setParticipantError("");
    const body = {
      ...capitalEventForm,
      amountPkr: Number(capitalEventForm.amountPkr || 0),
      investorProfitSharePercent: capitalEventForm.investorProfitSharePercent === "" ? undefined : Number(capitalEventForm.investorProfitSharePercent),
      managerProfitSharePercent: capitalEventForm.managerProfitSharePercent === "" ? undefined : Number(capitalEventForm.managerProfitSharePercent),
    };
    const res = await apiCall(`/api/v1/investment-participants/${capitalEventForm.participantId}/capital-events`, { method: "POST", body });
    setParticipantSaving(false);
    if ((res as any).success === false) {
      setParticipantError((res as any).error || "Failed to save capital event");
      return;
    }
    setCapitalEventForm((prev) => ({ ...prev, amountPkr: "", reference: "", remarks: "" }));
    await loadParticipants();
  };

  const saveShareEvent = async () => {
    if (!shareEventForm.participantId) { setParticipantError("Select a participant for the profit-share change"); return; }
    setParticipantSaving(true);
    setParticipantError("");
    const res = await apiCall(`/api/v1/investment-participants/${shareEventForm.participantId}/profit-share-events`, {
      method: "POST",
      body: {
        ...shareEventForm,
        investorProfitSharePercent: Number(shareEventForm.investorProfitSharePercent),
        managerProfitSharePercent: Number(shareEventForm.managerProfitSharePercent),
      },
    });
    setParticipantSaving(false);
    if ((res as any).success === false) {
      setParticipantError((res as any).error || "Failed to save profit-share change");
      return;
    }
    setShareEventForm((prev) => ({ ...prev, reference: "", remarks: "" }));
    await loadParticipants();
  };

  const saveParticipantAction = async () => {
    if (!participantActionForm.participantId) { setParticipantError("Select a participant for the investor action"); return; }
    if (!participantActionForm.reference.trim()) { setParticipantError("Reference is required for investor action idempotency"); return; }
    const selected = participants.find((p) => String(p.id) === String(participantActionForm.participantId));
    const balance = selected?.balance || {};
    if (participantActionForm.actionType === "full_exit" && (Number(balance.currentAvailableProfitPkr || 0) !== 0 || Number(balance.currentParticipatingCapitalPkr || 0) !== 0)) {
      setParticipantError("Full exit requires current capital and available finalized profit to be zero first.");
      return;
    }
    const profitAmount = participantActionForm.actionType === "full_exit" ? 0 : Number(participantActionForm.profitAmountPkr || 0);
    const capitalAmount = participantActionForm.actionType === "full_exit" ? 0 : Number(participantActionForm.capitalAmountPkr || 0);
    const nextCapital = participantActionForm.actionType === "profit_reinvestment"
      ? Number(balance.currentParticipatingCapitalPkr || 0) + profitAmount
      : Number(balance.currentParticipatingCapitalPkr || 0) - capitalAmount;
    const nextProfit = Number(balance.currentAvailableProfitPkr || 0) - profitAmount;
    const confirmation = window.prompt(
      `Type CONFIRM to record ${participantActionForm.actionType.replaceAll("_", " ")} for ${selected?.name || "participant"}.\nCurrent capital: PKR ${formatNumber(balance.currentParticipatingCapitalPkr || 0)}\nCurrent profit: PKR ${formatNumber(balance.currentAvailableProfitPkr || 0)}\nResulting capital: PKR ${formatNumber(nextCapital)}\nResulting profit: PKR ${formatNumber(nextProfit)}`
    );
    if (confirmation !== "CONFIRM") return;
    setParticipantSaving(true);
    setParticipantError("");
    const body = {
      ...participantActionForm,
      profitAmountPkr: profitAmount,
      capitalAmountPkr: capitalAmount,
      amountPkr: participantActionForm.actionType === "capital_withdrawal" ? capitalAmount : profitAmount,
      confirmation,
      confirmationReference: participantActionForm.reference.trim(),
      idempotencyKey: participantActionForm.reference.trim(),
    };
    const res = await apiCall(`/api/v1/investment-participants/${participantActionForm.participantId}/actions`, { method: "POST", body });
    setParticipantSaving(false);
    if ((res as any).success === false) {
      setParticipantError((res as any).error || "Failed to record investor action");
      return;
    }
    setParticipantActionForm((prev) => ({ ...prev, profitAmountPkr: "", capitalAmountPkr: "", reference: "", remarks: "" }));
    await loadParticipants();
  };

  const participantActions = participants.flatMap((participant) =>
    (participant.participantActions || []).map((action: any) => ({ ...action, participantName: participant.name, participantId: participant.id }))
  );
  const settleableActions = participantActions.filter((action: any) =>
    ["profit_withdrawal", "capital_withdrawal", "mixed_withdrawal", "full_exit"].includes(String(action.actionType)) &&
    action.status === "active" &&
    Number(action.remainingSettlementPkr || 0) > 0
  );
  const selectedSettlementAction = settleableActions.find((action: any) => String(action.id) === String(settlementForm.actionId));

  const saveInvestorSettlement = async () => {
    if (!settlementForm.participantId || !settlementForm.actionId) { setParticipantError("Select an investor action to settle"); return; }
    if (!settlementForm.currencyId) { setParticipantError("Select settlement currency"); return; }
    if (!settlementForm.paymentReference.trim()) { setParticipantError("Payment/reference is required for settlement idempotency"); return; }
    if (!settlementForm.paymentMethod.trim()) { setParticipantError("Payment method is required"); return; }
    const selected = selectedSettlementAction;
    const confirmation = window.prompt(
      `Type CONFIRM to record investor settlement.\nAction obligation: PKR ${formatNumber(selected?.totalAmountPkr || 0)}\nRemaining: PKR ${formatNumber(selected?.remainingSettlementPkr || 0)}`
    );
    if (confirmation !== "CONFIRM") return;
    setParticipantSaving(true);
    setParticipantError("");
    const res = await apiCall(`/api/v1/investment-participants/${settlementForm.participantId}/actions/${settlementForm.actionId}/settlements`, {
      method: "POST",
      body: {
        ...settlementForm,
        settlementAmount: Number(settlementForm.settlementAmount || 0),
        exchangeRate: settlementForm.exchangeRate ? Number(settlementForm.exchangeRate) : undefined,
        profitComponentPkr: settlementForm.profitComponentPkr ? Number(settlementForm.profitComponentPkr) : undefined,
        capitalComponentPkr: settlementForm.capitalComponentPkr ? Number(settlementForm.capitalComponentPkr) : undefined,
        idempotencyKey: settlementForm.paymentReference.trim(),
        confirmation,
      },
    });
    setParticipantSaving(false);
    if ((res as any).success === false) {
      setParticipantError((res as any).error?.message || (res as any).error || "Failed to record settlement");
      return;
    }
    setSettlementForm((prev) => ({
      ...prev,
      settlementAmount: "",
      exchangeRate: "",
      profitComponentPkr: "",
      capitalComponentPkr: "",
      paymentReference: "",
      bankCashAccount: "",
    }));
    await loadParticipants();
  };

  const reverseInvestorSettlement = async (action: any, settlement: any) => {
    const reason = window.prompt("Enter settlement reversal reason");
    if (!reason?.trim()) return;
    const reference = window.prompt("Enter unique reversal reference");
    if (!reference?.trim()) return;
    setParticipantSaving(true);
    setParticipantError("");
    const res = await apiCall(`/api/v1/investment-participants/${action.participantId}/actions/${action.id}/settlements`, {
      method: "POST",
      body: {
        action: "reverse",
        settlementId: settlement.id,
        reversalReason: reason.trim(),
        paymentReference: reference.trim(),
        idempotencyKey: reference.trim(),
        confirmation: "CONFIRM",
      },
    });
    setParticipantSaving(false);
    if ((res as any).success === false) {
      setParticipantError((res as any).error?.message || (res as any).error || "Failed to reverse settlement");
      return;
    }
    await loadParticipants();
  };

  const startSettlementPayment = (action: any, settlement: any) => {
    const currency = currencies.find((row) => String(row.code).toUpperCase() === String(settlement.currencyCode).toUpperCase());
    setSettlementPaymentForm((prev) => ({
      ...prev,
      participantId: String(action.participantId),
      actionId: String(action.id),
      settlementId: String(settlement.id),
      currencyId: currency ? String(currency.id) : "",
      paymentAmount: "",
      exchangeRate: settlement.exchangeRate ? String(settlement.exchangeRate) : "",
      paymentReference: "",
      paymentMethod: "",
      remarks: "",
    }));
  };

  const saveSettlementPayment = async () => {
    if (!settlementPaymentForm.participantId || !settlementPaymentForm.actionId || !settlementPaymentForm.settlementId) { setParticipantError("Select settlement to pay"); return; }
    if (!settlementPaymentForm.superAdminBankAccountId) { setParticipantError("Select bank/cash account"); return; }
    if (!settlementPaymentForm.currencyId) { setParticipantError("Select payment currency"); return; }
    if (!settlementPaymentForm.paymentReference.trim()) { setParticipantError("Payment reference is required"); return; }
    if (!settlementPaymentForm.paymentMethod.trim()) { setParticipantError("Payment method is required"); return; }
    const confirmation = window.prompt("Type CONFIRM to record actual investor settlement money movement. This will reduce selected cash/bank balance but will not affect business P/L.");
    if (confirmation !== "CONFIRM") return;
    setParticipantSaving(true);
    setParticipantError("");
    const res = await apiCall(`/api/v1/investment-participants/${settlementPaymentForm.participantId}/actions/${settlementPaymentForm.actionId}/settlements/${settlementPaymentForm.settlementId}/payments`, {
      method: "POST",
      body: {
        ...settlementPaymentForm,
        paymentAmount: Number(settlementPaymentForm.paymentAmount || 0),
        exchangeRate: settlementPaymentForm.exchangeRate ? Number(settlementPaymentForm.exchangeRate) : undefined,
        idempotencyKey: settlementPaymentForm.paymentReference.trim(),
        confirmation,
      },
    });
    setParticipantSaving(false);
    if ((res as any).success === false) {
      setParticipantError((res as any).error?.message || (res as any).error || "Failed to record settlement payment");
      return;
    }
    setSettlementPaymentForm((prev) => ({ ...prev, settlementId: "", actionId: "", participantId: "", paymentAmount: "", exchangeRate: "", paymentReference: "", paymentMethod: "", remarks: "" }));
    await Promise.all([loadParticipants(), loadSuperAdminAccounts()]);
  };

  const reverseSettlementPayment = async (action: any, settlement: any, payment: any) => {
    const reason = window.prompt("Enter settlement payment reversal reason");
    if (!reason?.trim()) return;
    const reference = window.prompt("Enter unique payment reversal reference");
    if (!reference?.trim()) return;
    setParticipantSaving(true);
    setParticipantError("");
    const res = await apiCall(`/api/v1/investment-participants/${action.participantId}/actions/${action.id}/settlements/${settlement.id}/payments`, {
      method: "POST",
      body: {
        action: "reverse",
        paymentId: payment.id,
        reversalReason: reason.trim(),
        paymentReference: reference.trim(),
        idempotencyKey: reference.trim(),
        confirmation: "CONFIRM",
      },
    });
    setParticipantSaving(false);
    if ((res as any).success === false) {
      setParticipantError((res as any).error?.message || (res as any).error || "Failed to reverse settlement payment");
      return;
    }
    await Promise.all([loadParticipants(), loadSuperAdminAccounts()]);
  };

  if (!user || user.role !== "super_admin") return null;

  const filtered = investors.filter(inv =>
    inv.name.toLowerCase().includes(search.toLowerCase()) ||
    (inv.relationship ?? "").toLowerCase().includes(search.toLowerCase()) ||
    (inv.phone ?? "").includes(search)
  );

  return (
    <div className="space-y-4 max-w-2xl mx-auto">
      <div className="pb-3 border-b border-gray-100 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Investors</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-xl transition-colors"
        >
          <Plus size={15} />
          New Investor
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          type="text"
          placeholder="Search by name, relationship or phone…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-9 pr-9 py-2.5 text-sm border border-gray-200 rounded-xl outline-none focus:border-violet-400 bg-white"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full px-1 text-sm leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </div>
      {showOfflineSnapshot && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing last synced data (offline mode).
        </div>
      )}

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3">
          <p className="text-sm font-semibold text-gray-900">Participation Setup</p>
          <p className="text-xs text-gray-400">Capital events create participation boundaries from their effective date.</p>
        </div>
        {participantError && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{participantError}</p>}
        <div className="grid gap-3">
          <div className="rounded-xl border border-gray-100 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">New participant</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Name" value={participantForm.name} onChange={(e) => setParticipantForm(p => ({ ...p, name: e.target.value }))} />
              <select className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={participantForm.type} onChange={(e) => setParticipantForm(p => ({ ...p, type: e.target.value }))}>
                <option value="investor">Investor</option>
                <option value="manager">Manager</option>
              </select>
              <input type="date" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={participantForm.effectiveDate} onChange={(e) => setParticipantForm(p => ({ ...p, effectiveDate: e.target.value }))} />
              <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Opening capital PKR" value={participantForm.initialCapitalPkr} onChange={(e) => setParticipantForm(p => ({ ...p, initialCapitalPkr: e.target.value }))} />
              {participantForm.type !== "manager" && (
                <>
                  <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Investor share %" value={participantForm.investorProfitSharePercent} onChange={(e) => setParticipantForm(p => ({ ...p, investorProfitSharePercent: e.target.value }))} />
                  <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Manager share %" value={participantForm.managerProfitSharePercent} onChange={(e) => setParticipantForm(p => ({ ...p, managerProfitSharePercent: e.target.value }))} />
                </>
              )}
              <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs sm:col-span-2" placeholder="Remarks/reference" value={participantForm.remarks} onChange={(e) => setParticipantForm(p => ({ ...p, remarks: e.target.value }))} />
            </div>
            <button onClick={saveParticipant} disabled={participantSaving || !isOnline} className="mt-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Save participant</button>
          </div>

          <div className="rounded-xl border border-gray-100 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Capital event</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={capitalEventForm.participantId} onChange={(e) => setCapitalEventForm(p => ({ ...p, participantId: e.target.value }))}>
                <option value="">Select participant</option>
                {participants.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.type})</option>)}
              </select>
              <select className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={capitalEventForm.eventType} onChange={(e) => setCapitalEventForm(p => ({ ...p, eventType: e.target.value }))}>
                <option value="opening">Opening capital</option>
                <option value="capital_contribution">Additional capital</option>
                <option value="capital_withdrawal">Capital withdrawal</option>
                <option value="profit_reinvestment">Profit reinvestment</option>
                <option value="full_exit">Full exit</option>
              </select>
              <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Amount PKR" value={capitalEventForm.amountPkr} onChange={(e) => setCapitalEventForm(p => ({ ...p, amountPkr: e.target.value }))} />
              <input type="date" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={capitalEventForm.effectiveDate} onChange={(e) => setCapitalEventForm(p => ({ ...p, effectiveDate: e.target.value }))} />
              <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Reference" value={capitalEventForm.reference} onChange={(e) => setCapitalEventForm(p => ({ ...p, reference: e.target.value }))} />
              <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Remarks" value={capitalEventForm.remarks} onChange={(e) => setCapitalEventForm(p => ({ ...p, remarks: e.target.value }))} />
            </div>
            <button onClick={saveCapitalEvent} disabled={participantSaving || !isOnline} className="mt-2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Save capital event</button>
          </div>

          <div className="rounded-xl border border-gray-100 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Profit-share change</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={shareEventForm.participantId} onChange={(e) => setShareEventForm(p => ({ ...p, participantId: e.target.value }))}>
                <option value="">Select investor</option>
                {participants.filter((p) => p.type !== "manager").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <input type="date" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={shareEventForm.effectiveDate} onChange={(e) => setShareEventForm(p => ({ ...p, effectiveDate: e.target.value }))} />
              <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Investor share %" value={shareEventForm.investorProfitSharePercent} onChange={(e) => setShareEventForm(p => ({ ...p, investorProfitSharePercent: e.target.value }))} />
              <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Manager share %" value={shareEventForm.managerProfitSharePercent} onChange={(e) => setShareEventForm(p => ({ ...p, managerProfitSharePercent: e.target.value }))} />
              <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Reference" value={shareEventForm.reference} onChange={(e) => setShareEventForm(p => ({ ...p, reference: e.target.value }))} />
              <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Remarks" value={shareEventForm.remarks} onChange={(e) => setShareEventForm(p => ({ ...p, remarks: e.target.value }))} />
            </div>
            <button onClick={saveShareEvent} disabled={participantSaving || !isOnline} className="mt-2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Save share change</button>
          </div>

          <div className="rounded-xl border border-amber-100 bg-amber-50/40 p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-700">Investor withdrawals / reinvestment</p>
            <p className="mb-2 text-[11px] text-amber-700">Investor-side records only — no business expense, journal, cash, bank, or running-balance entry is created here.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <select className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={participantActionForm.participantId} onChange={(e) => setParticipantActionForm(p => ({ ...p, participantId: e.target.value }))}>
                <option value="">Select participant</option>
                {participants.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.type})</option>)}
              </select>
              <select className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={participantActionForm.actionType} onChange={(e) => setParticipantActionForm(p => ({ ...p, actionType: e.target.value }))}>
                <option value="profit_withdrawal">Withdraw Profit</option>
                <option value="capital_withdrawal">Withdraw Capital</option>
                <option value="mixed_withdrawal">Mixed Withdrawal</option>
                <option value="profit_reinvestment">Reinvest Profit</option>
                <option value="full_exit">Full Exit</option>
              </select>
              {["profit_withdrawal", "mixed_withdrawal", "profit_reinvestment"].includes(participantActionForm.actionType) && (
                <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Profit amount PKR" value={participantActionForm.profitAmountPkr} onChange={(e) => setParticipantActionForm(p => ({ ...p, profitAmountPkr: e.target.value }))} />
              )}
              {["capital_withdrawal", "mixed_withdrawal"].includes(participantActionForm.actionType) && (
                <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Capital amount PKR" value={participantActionForm.capitalAmountPkr} onChange={(e) => setParticipantActionForm(p => ({ ...p, capitalAmountPkr: e.target.value }))} />
              )}
              <input type="date" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={participantActionForm.effectiveDate} onChange={(e) => setParticipantActionForm(p => ({ ...p, effectiveDate: e.target.value }))} />
              <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Unique reference / idempotency key" value={participantActionForm.reference} onChange={(e) => setParticipantActionForm(p => ({ ...p, reference: e.target.value }))} />
              <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs sm:col-span-2" placeholder="Remarks" value={participantActionForm.remarks} onChange={(e) => setParticipantActionForm(p => ({ ...p, remarks: e.target.value }))} />
            </div>
            {participantActionForm.participantId && (
              <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-4">
                {(() => {
                  const selected = participants.find((p) => String(p.id) === String(participantActionForm.participantId));
                  const balance = selected?.balance || {};
                  return (
                    <>
                      <span className="rounded-lg bg-white px-2 py-1">Capital PKR {formatNumber(balance.currentParticipatingCapitalPkr || 0)}</span>
                      <span className="rounded-lg bg-white px-2 py-1">Available profit PKR {formatNumber(balance.currentAvailableProfitPkr || 0)}</span>
                      <span className="rounded-lg bg-white px-2 py-1">Withdrawn profit PKR {formatNumber(balance.profitWithdrawnPkr || 0)}</span>
                      <span className="rounded-lg bg-white px-2 py-1">Reinvested PKR {formatNumber(balance.profitReinvestedPkr || 0)}</span>
                    </>
                  );
                })()}
              </div>
            )}
            <button onClick={saveParticipantAction} disabled={participantSaving || !isOnline} className="mt-2 rounded-lg bg-amber-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Record investor action</button>
          </div>
        </div>
        <div className="mt-3 overflow-x-auto rounded-xl border border-gray-100">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-gray-50 text-gray-500"><tr><th className="px-3 py-2">Participant</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Capital</th><th className="px-3 py-2">Available Profit</th><th className="px-3 py-2">Settlement</th><th className="px-3 py-2">Split</th><th className="px-3 py-2">Status</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {participants.map((p) => (
                <tr key={p.id}>
                  <td className="px-3 py-2 font-medium text-gray-800">{p.name}</td>
                  <td className="px-3 py-2 capitalize">{p.type}</td>
                  <td className="px-3 py-2">PKR {formatNumber(p.balance?.currentParticipatingCapitalPkr ?? p.capitalPkr)}</td>
                  <td className="px-3 py-2">PKR {formatNumber(p.balance?.currentAvailableProfitPkr ?? 0)}</td>
                  <td className="px-3 py-2">
                    {p.participantActions?.[0] ? (
                      <div className="space-y-0.5">
                        <p className="capitalize">{String(p.participantActions[0].settlementStatus || "unsettled").replaceAll("_", " ")}</p>
                        <p className="text-[10px] text-gray-400">Paid PKR {formatNumber(p.participantActions[0].settledAmountPkr || 0)} · Rem PKR {formatNumber(p.participantActions[0].remainingSettlementPkr || 0)}</p>
                      </div>
                    ) : "—"}
                  </td>
                  <td className="px-3 py-2">{p.latestInvestorProfitSharePercent ?? "—"} / {p.latestManagerProfitSharePercent ?? "—"}</td>
                  <td className="px-3 py-2">{p.isActive ? "Active" : `Exited ${p.exitedAt || ""}`}</td>
                </tr>
              ))}
              {participants.length === 0 && <tr><td colSpan={7} className="px-3 py-4 text-center text-gray-400">No explicit participants yet. Legacy investor rows will be labelled as derived in preview.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50/50 p-3">
          <p className="text-sm font-semibold text-emerald-950">Investor settlement execution</p>
          <p className="mb-2 text-[11px] text-emerald-700">Manual settlement records only — no automatic bank transfer, payment, expense, journal, or running-balance mutation is created.</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <select className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={settlementForm.actionId} onChange={(e) => {
              const action = settleableActions.find((row: any) => String(row.id) === e.target.value);
              setSettlementForm((prev) => ({ ...prev, actionId: e.target.value, participantId: action ? String(action.participantId) : "" }));
            }}>
              <option value="">Select unsettled action</option>
              {settleableActions.map((action: any) => (
                <option key={action.id} value={action.id}>
                  {action.participantName} · {String(action.actionType).replaceAll("_", " ")} · Rem PKR {formatNumber(action.remainingSettlementPkr || 0)}
                </option>
              ))}
            </select>
            <input type="date" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={settlementForm.paymentDate} onChange={(e) => setSettlementForm((prev) => ({ ...prev, paymentDate: e.target.value }))} />
            <select className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={settlementForm.currencyId} onChange={(e) => setSettlementForm((prev) => ({ ...prev, currencyId: e.target.value }))}>
              <option value="">Currency</option>
              {currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}
            </select>
            <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Settlement amount" value={settlementForm.settlementAmount} onChange={(e) => setSettlementForm((prev) => ({ ...prev, settlementAmount: e.target.value }))} />
            <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="FX rate to PKR if non-PKR" value={settlementForm.exchangeRate} onChange={(e) => setSettlementForm((prev) => ({ ...prev, exchangeRate: e.target.value }))} />
            <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Payment/reference" value={settlementForm.paymentReference} onChange={(e) => setSettlementForm((prev) => ({ ...prev, paymentReference: e.target.value }))} />
            <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Payment method" value={settlementForm.paymentMethod} onChange={(e) => setSettlementForm((prev) => ({ ...prev, paymentMethod: e.target.value }))} />
            <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Bank/cash account label" value={settlementForm.bankCashAccount} onChange={(e) => setSettlementForm((prev) => ({ ...prev, bankCashAccount: e.target.value }))} />
            {["mixed_withdrawal", "full_exit"].includes(String(selectedSettlementAction?.actionType || "")) && (
              <>
                <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Profit allocation PKR" value={settlementForm.profitComponentPkr} onChange={(e) => setSettlementForm((prev) => ({ ...prev, profitComponentPkr: e.target.value }))} />
                <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Capital allocation PKR" value={settlementForm.capitalComponentPkr} onChange={(e) => setSettlementForm((prev) => ({ ...prev, capitalComponentPkr: e.target.value }))} />
              </>
            )}
          </div>
          {selectedSettlementAction && (
            <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-4">
              <span className="rounded-lg bg-white px-2 py-1">Obligation PKR {formatNumber(selectedSettlementAction.totalAmountPkr || 0)}</span>
              <span className="rounded-lg bg-white px-2 py-1">Settled PKR {formatNumber(selectedSettlementAction.settledAmountPkr || 0)}</span>
              <span className="rounded-lg bg-white px-2 py-1">Remaining PKR {formatNumber(selectedSettlementAction.remainingSettlementPkr || 0)}</span>
              <span className="rounded-lg bg-white px-2 py-1 capitalize">{String(selectedSettlementAction.settlementStatus || "unsettled").replaceAll("_", " ")}</span>
            </div>
          )}
          <button onClick={saveInvestorSettlement} disabled={participantSaving || !isOnline} className="mt-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Add settlement</button>
          {settlementPaymentForm.settlementId && (
            <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-950">Record Settlement Payment</p>
              <p className="mb-2 text-[11px] text-amber-700">Actual money movement — posts Investor Settlement Payable against selected superadmin cash/bank, not expense.</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <select className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={settlementPaymentForm.superAdminBankAccountId} onChange={(e) => {
                  const account = superAdminAccounts.find((row) => String(row.id) === e.target.value);
                  setSettlementPaymentForm((prev) => ({ ...prev, superAdminBankAccountId: e.target.value, currencyId: account?.currencyId ? String(account.currencyId) : prev.currencyId }));
                }}>
                  <option value="">Bank/cash account</option>
                  {superAdminAccounts.map((account) => (
                    <option key={account.id} value={account.id}>{account.bankName} ({account.currency?.code || account.currencyCode}) · {account.accountKind}</option>
                  ))}
                </select>
                <input type="date" className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={settlementPaymentForm.paymentDate} onChange={(e) => setSettlementPaymentForm((prev) => ({ ...prev, paymentDate: e.target.value }))} />
                <select className="rounded-lg border border-gray-200 px-3 py-2 text-xs" value={settlementPaymentForm.currencyId} onChange={(e) => setSettlementPaymentForm((prev) => ({ ...prev, currencyId: e.target.value }))}>
                  <option value="">Currency</option>
                  {currencies.map((currency) => <option key={currency.id} value={currency.id}>{currency.code}</option>)}
                </select>
                <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Payment amount" value={settlementPaymentForm.paymentAmount} onChange={(e) => setSettlementPaymentForm((prev) => ({ ...prev, paymentAmount: e.target.value }))} />
                <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="FX rate to PKR if non-PKR" value={settlementPaymentForm.exchangeRate} onChange={(e) => setSettlementPaymentForm((prev) => ({ ...prev, exchangeRate: e.target.value }))} />
                <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Payment reference" value={settlementPaymentForm.paymentReference} onChange={(e) => setSettlementPaymentForm((prev) => ({ ...prev, paymentReference: e.target.value }))} />
                <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs" placeholder="Payment method" value={settlementPaymentForm.paymentMethod} onChange={(e) => setSettlementPaymentForm((prev) => ({ ...prev, paymentMethod: e.target.value }))} />
                <input className="rounded-lg border border-gray-200 px-3 py-2 text-xs sm:col-span-2" placeholder="Remarks" value={settlementPaymentForm.remarks} onChange={(e) => setSettlementPaymentForm((prev) => ({ ...prev, remarks: e.target.value }))} />
              </div>
              <div className="mt-2 flex gap-2">
                <button onClick={saveSettlementPayment} disabled={participantSaving || !isOnline} className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-medium text-white disabled:opacity-50">Record payment</button>
                <button onClick={() => setSettlementPaymentForm((prev) => ({ ...prev, settlementId: "", actionId: "", participantId: "" }))} className="rounded-lg border border-amber-200 px-3 py-2 text-xs text-amber-800">Cancel</button>
              </div>
            </div>
          )}
          <div className="mt-3 overflow-x-auto rounded-lg border border-emerald-100 bg-white">
            <table className="min-w-full text-left text-[11px]">
              <thead className="bg-gray-50 text-gray-500"><tr><th className="px-2 py-1.5">Action</th><th className="px-2 py-1.5">Obligation</th><th className="px-2 py-1.5">Settled</th><th className="px-2 py-1.5">Remaining</th><th className="px-2 py-1.5">Settlements</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {participantActions.map((action: any) => (
                  <tr key={action.id}>
                    <td className="px-2 py-1.5">{action.participantName}<br /><span className="capitalize text-gray-400">{String(action.actionType).replaceAll("_", " ")}</span></td>
                    <td className="px-2 py-1.5">PKR {formatNumber(action.totalAmountPkr || 0)}</td>
                    <td className="px-2 py-1.5">PKR {formatNumber(action.settledAmountPkr || 0)}</td>
                    <td className="px-2 py-1.5">PKR {formatNumber(action.remainingSettlementPkr || 0)}<br /><span className="capitalize text-gray-400">{String(action.settlementStatus || "unsettled").replaceAll("_", " ")}</span></td>
                    <td className="px-2 py-1.5">
                      {(action.settlements || []).length ? (
                        <div className="space-y-1">
                          {action.settlements.map((settlement: any) => (
                            <div key={settlement.id} className="rounded-md bg-gray-50 px-2 py-1">
                              <span>{settlement.currencyCode} {formatNumber(settlement.settlementAmount)} → PKR {formatNumber(settlement.pkrEquivalent)}</span>
                              <span className="ml-1 text-gray-400">Ref {settlement.paymentReference} · Paid PKR {formatNumber(settlement.paidPkr || 0)} · Unpaid PKR {formatNumber(settlement.remainingUnpaidPkr || 0)}</span>
                              {settlement.status !== "reversed" && (
                                <>
                                  <button onClick={() => startSettlementPayment(action, settlement)} className="ml-2 text-amber-700">Pay</button>
                                  <button onClick={() => reverseInvestorSettlement(action, settlement)} className="ml-2 text-red-600">Reverse</button>
                                </>
                              )}
                              {(settlement.payments || []).map((payment: any) => (
                                <div key={payment.id} className="mt-1 pl-2 text-[10px] text-gray-500">
                                  Payment: {payment.currencyCode} {formatNumber(payment.paymentAmount)} / PKR {formatNumber(payment.pkrEquivalent)} · {payment.accountName || "Account"} · Ref {payment.paymentReference}
                                  {payment.status !== "reversed" && <button onClick={() => reverseSettlementPayment(action, settlement, payment)} className="ml-2 text-red-600">Reverse payment</button>}
                                </div>
                              ))}
                            </div>
                          ))}
                        </div>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
                {participantActions.length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-center text-gray-400">No investor actions yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Investor Profit/Loss Attribution</p>
            <p className="text-xs text-gray-400">Preview only — no distribution or finalization postings are created.</p>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              value={attributionYear}
              onChange={(event) => setAttributionYear(parseInt(event.target.value) || new Date().getFullYear())}
              className="w-24 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
            />
            <button
              onClick={loadAttributionPreview}
              disabled={attributionLoading || !isOnline}
              className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {attributionLoading ? "Loading…" : "Preview"}
            </button>
          </div>
        </div>
        {attributionError && <p className="mt-3 text-xs text-red-500">{attributionError}</p>}
        {attributionPreview && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-emerald-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-emerald-700">Business Result</p>
                <p className="text-sm font-bold text-emerald-900">PKR {formatNumber(attributionPreview.totalBusinessProfitPkr)}</p>
              </div>
              <div className="rounded-xl bg-amber-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-amber-700">Rates</p>
                <p className={attributionPreview.requiredRatesStatus === "COMPLETE" ? "text-sm font-bold text-emerald-700" : "text-sm font-bold text-red-600"}>
                  {attributionPreview.requiredRatesStatus}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3 sm:col-span-2">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Readiness</p>
                <p className={attributionPreview.readiness?.status === "READY" ? "text-sm font-bold text-emerald-700" : "text-sm font-bold text-red-600"}>
                  {attributionPreview.readiness?.status || "BLOCKED_DATA_INTEGRITY"}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-xl bg-violet-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-violet-700">Attributed</p>
                <p className="text-sm font-bold text-violet-900">PKR {formatNumber(attributionPreview.totalAttributedPkr)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Manager Own Capital</p>
                <p className="text-sm font-bold text-slate-900">PKR {formatNumber(attributionPreview.totalManagerOwnCapitalProfitPkr ?? 0)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-slate-500">Manager Split Share</p>
                <p className="text-sm font-bold text-slate-900">PKR {formatNumber(attributionPreview.totalManagerSharePkr ?? 0)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 p-3">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Reconciliation</p>
                <p className={attributionPreview.reconciliationStatus === "RECONCILED" ? "text-sm font-bold text-emerald-700" : "text-sm font-bold text-red-600"}>
                  {attributionPreview.reconciliationStatus} · PKR {formatNumber(attributionPreview.reconciliationDifferencePkr)}
                </p>
              </div>
            </div>
            {attributionPreview.capitalSourceLabel && (
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
                Capital source: <span className="font-semibold">{attributionPreview.capitalSourceLabel}</span>
              </div>
            )}
            {attributionPreview.legacyCapitalReview && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">Legacy capital review</p>
                    <p className="text-amber-700">Read-only backfill preview — no explicit capital events are created yet.</p>
                  </div>
                  <div className="text-right text-amber-800">
                    <p>Accounts: {attributionPreview.legacyCapitalReview.summary?.accountCount ?? 0}</p>
                    <p>Opening candidate: PKR {formatNumber(attributionPreview.legacyCapitalReview.summary?.proposedOpeningCapitalPkr ?? 0)}</p>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-amber-100 bg-white/70">
                  <table className="min-w-full text-left text-[11px]">
                    <thead className="text-amber-700">
                      <tr><th className="px-2 py-1.5">Participant</th><th className="px-2 py-1.5">Currency</th><th className="px-2 py-1.5">Implied capital</th><th className="px-2 py-1.5">Opening date</th><th className="px-2 py-1.5">Split</th><th className="px-2 py-1.5">Ambiguities</th></tr>
                    </thead>
                    <tbody className="divide-y divide-amber-100">
                      {(attributionPreview.legacyCapitalReview.rows || []).map((row: any) => (
                        <tr key={`${row.investorId}-${row.accountId}`}>
                          <td className="px-2 py-1.5 font-medium">{row.investorName}</td>
                          <td className="px-2 py-1.5">{row.currencyCode}</td>
                          <td className="px-2 py-1.5">PKR {formatNumber(row.impliedCapitalPkr)}</td>
                          <td className="px-2 py-1.5">{row.proposedOpeningEffectiveDate}</td>
                          <td className="px-2 py-1.5">{row.investorProfitSharePercent ?? "—"} / {row.managerProfitSharePercent ?? "—"}</td>
                          <td className="px-2 py-1.5">{row.ambiguities?.length ? row.ambiguities.join(" · ") : "None"}</td>
                        </tr>
                      ))}
                      {(!attributionPreview.legacyCapitalReview.rows || attributionPreview.legacyCapitalReview.rows.length === 0) && (
                        <tr><td colSpan={6} className="px-2 py-3 text-center text-amber-700">No legacy investor accounts found for backfill review.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {attributionPreview.missingRequiredRates?.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <p className="font-semibold">Missing FX rates</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {attributionPreview.missingRequiredRates.map((rate: string) => <li key={rate}>{rate}</li>)}
                </ul>
              </div>
            )}
            {attributionPreview.finalizationDisabledReasons?.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <p className="font-semibold">Finalization disabled</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {attributionPreview.finalizationDisabledReasons.map((reason: string) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            )}
            {attributionPreview.readiness?.blockers?.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <p className="font-semibold">Readiness blockers</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {attributionPreview.readiness.blockers.map((reason: string) => <li key={reason}>{reason}</li>)}
                </ul>
              </div>
            )}
            {attributionPreview.finalizationDryRun && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-800">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">Finalize Preview / Dry Run</p>
                    <p className="text-slate-500">Design only — finalization button remains disabled and no postings are created.</p>
                  </div>
                  <div className="text-right">
                    <p>Status: <span className={attributionPreview.finalizationDryRun.status === "READY" ? "font-semibold text-emerald-700" : "font-semibold text-red-700"}>{attributionPreview.finalizationDryRun.status}</span></p>
                    <p>Recon: PKR {formatNumber(attributionPreview.finalizationDryRun.frozenPreview?.reconciliationDifferencePkr ?? 0)}</p>
                  </div>
                </div>
                <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800">
                  <p className="font-semibold">Finalization Control</p>
                  <p>Finalize freezes ownership/attribution only. It does not create withdrawals, distributions, journal entries, cash/bank movements, or running-balance changes.</p>
                  <button
                    onClick={finalizeAttributionPeriod}
                    disabled={finalizationSaving || !isOnline || attributionPreview.finalizationDryRun.status !== "READY"}
                    className="mt-2 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {finalizationSaving ? "Finalizing…" : "Finalize Period"}
                  </button>
                </div>
                {attributionPreview.finalizationDryRun.blockers?.length > 0 && (
                  <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-red-700">
                    {attributionPreview.finalizationDryRun.blockers.map((blocker: any) => <p key={`${blocker.code}-${blocker.message}`}>{blocker.code}: {blocker.message}</p>)}
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-white/80 p-2">
                    <p className="font-semibold">Snapshot Model</p>
                    <p>{attributionPreview.finalizationDryRun.snapshotDesign?.tables?.length || 0} immutable snapshot record types</p>
                    <p>{attributionPreview.finalizationDryRun.snapshotDesign?.correctionWorkflow}</p>
                  </div>
                  <div className="rounded-lg bg-white/80 p-2">
                    <p className="font-semibold">Frozen Sources</p>
                    <p>{attributionPreview.finalizationDryRun.frozenPreview?.sourceReportReference}</p>
                    <p>Pools {attributionPreview.finalizationDryRun.frozenPreview?.historicalPoolCount} · Links {attributionPreview.finalizationDryRun.frozenPreview?.transactionLinkCount}</p>
                  </div>
                  <div className="rounded-lg bg-white/80 p-2">
                    <p className="font-semibold">Reversal Design</p>
                    <p>{attributionPreview.finalizationDryRun.reversalDesign?.workflow}</p>
                    <p>Direct edit: {attributionPreview.finalizationDryRun.reversalDesign?.directEditAllowed ? "Yes" : "No"}</p>
                  </div>
                </div>
                {attributionPreview.liveFxCoverage && (
                  <div className="mt-2 rounded-lg bg-white/80 p-2">
                    <p className="font-semibold">Live FX Coverage</p>
                    <div className="mt-1 grid gap-1 sm:grid-cols-2">
                      {(attributionPreview.liveFxCoverage.coverageSummary || []).map((row: any) => (
                        <div key={row.path} className={row.status === "SUPPORTED" ? "rounded-md bg-emerald-50 px-2 py-1 text-emerald-700" : "rounded-md bg-red-50 px-2 py-1 text-red-700"}>
                          <p className="font-medium">{String(row.path).replaceAll("_", " ")} · {row.status}</p>
                          <p>{row.reason}</p>
                        </div>
                      ))}
                    </div>
                    {attributionPreview.liveFxCoverage.supportedPositions?.length > 0 && (
                      <div className="mt-2 overflow-x-auto rounded-md border border-slate-100">
                        <table className="min-w-full text-left text-[11px]">
                          <thead className="text-slate-500">
                            <tr><th className="px-2 py-1">Position</th><th className="px-2 py-1">Currency</th><th className="px-2 py-1">Rate</th><th className="px-2 py-1">FX P/L</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {attributionPreview.liveFxCoverage.supportedPositions.map((position: any) => (
                              <tr key={position.sourceRecord}>
                                <td className="px-2 py-1">{position.sourcePosition}</td>
                                <td className="px-2 py-1">{position.currencyCode} {formatNumber(position.foreignAmount)}</td>
                                <td className="px-2 py-1">{position.selectedRateType} {formatNumber(position.valuationRate || 0)}</td>
                                <td className="px-2 py-1">PKR {formatNumber(position.fxGainLossPkr || 0)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-2 overflow-x-auto rounded-lg border border-slate-100 bg-white/80">
                  <table className="min-w-full text-left text-[11px]">
                    <thead className="text-slate-500">
                      <tr><th className="px-2 py-1.5">Participant</th><th className="px-2 py-1.5">Investor</th><th className="px-2 py-1.5">Manager Own</th><th className="px-2 py-1.5">Manager Share</th><th className="px-2 py-1.5">Residual</th><th className="px-2 py-1.5">Loss</th><th className="px-2 py-1.5">Net</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(attributionPreview.finalizationDryRun.proposedBalanceEffects || []).map((row: any) => (
                        <tr key={row.participantId}>
                          <td className="px-2 py-1.5">{row.participantName}</td>
                          <td className="px-2 py-1.5">PKR {formatNumber(row.investorEntitlementPkr)}</td>
                          <td className="px-2 py-1.5">PKR {formatNumber(row.managerOwnCapitalResultPkr)}</td>
                          <td className="px-2 py-1.5">PKR {formatNumber(row.managerProfitSharePkr)}</td>
                          <td className="px-2 py-1.5">PKR {formatNumber(row.managerExitedInvestorResidualPkr)}</td>
                          <td className="px-2 py-1.5">PKR {formatNumber(row.lossAllocationPkr)}</td>
                          <td className="px-2 py-1.5 font-semibold">PKR {formatNumber(row.netEffectPkr)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 rounded-lg bg-white/80 p-2">
                  <p className="font-semibold">Proposed Postings — Simulation Only</p>
                  <p className="text-slate-500">{attributionPreview.finalizationDryRun.postingSimulation?.chain}</p>
                  <div className="mt-1 grid gap-1 sm:grid-cols-4">
                    <p className="rounded-md bg-slate-50 px-2 py-1">Debits PKR {formatNumber(attributionPreview.finalizationDryRun.postingSimulation?.reconciliation?.totalDebitsPkr || 0)}</p>
                    <p className="rounded-md bg-slate-50 px-2 py-1">Credits PKR {formatNumber(attributionPreview.finalizationDryRun.postingSimulation?.reconciliation?.totalCreditsPkr || 0)}</p>
                    <p className="rounded-md bg-slate-50 px-2 py-1">D/C Diff PKR {formatNumber(attributionPreview.finalizationDryRun.postingSimulation?.reconciliation?.debitCreditDifferencePkr || 0)}</p>
                    <p className="rounded-md bg-slate-50 px-2 py-1">Chain Diff PKR {formatNumber(attributionPreview.finalizationDryRun.postingSimulation?.reconciliation?.historicalToFinancialReportDifferencePkr || 0)}</p>
                  </div>
                  {attributionPreview.finalizationDryRun.postingSimulation?.entries?.length > 0 && (
                    <div className="mt-2 max-h-56 overflow-auto rounded-md border border-slate-100">
                      <table className="min-w-full text-left text-[11px]">
                        <thead className="text-slate-500">
                          <tr><th className="px-2 py-1">Type</th><th className="px-2 py-1">Participant</th><th className="px-2 py-1">Debit</th><th className="px-2 py-1">Credit</th><th className="px-2 py-1">Amount</th></tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {attributionPreview.finalizationDryRun.postingSimulation.entries.map((entry: any) => (
                            <tr key={`${entry.postingType}-${entry.participantId}-${entry.reconciliationReference}`}>
                              <td className="px-2 py-1">{entry.postingType}</td>
                              <td className="px-2 py-1">{entry.participantName}</td>
                              <td className="px-2 py-1">{entry.debitAccount}</td>
                              <td className="px-2 py-1">{entry.creditAccount}</td>
                              <td className="px-2 py-1">PKR {formatNumber(entry.amountPkr)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
            {attributionPreview.historicalPoolPreview && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-3 py-3 text-xs text-indigo-900">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">Historical pool tracking</p>
                    <p className="text-indigo-700">Preview only — transactions stay attached to their original participation pool.</p>
                  </div>
                  <div className="text-right text-indigo-800">
                    <p>Pools: {attributionPreview.historicalPoolPreview.pools?.length ?? 0}</p>
                    <p>Links: {attributionPreview.historicalPoolPreview.transactionLinks?.length ?? 0}</p>
                    <p>Recon: PKR {formatNumber(attributionPreview.historicalPoolPreview.aggregateReconciliation?.reconciliationDifferencePkr ?? 0)}</p>
                  </div>
                </div>
                {attributionPreview.exchangeRateProviderStatus && (
                  <div className="mb-2 rounded-lg border border-indigo-100 bg-white/70 px-2 py-1.5">
                    <p className="font-semibold">FX providers</p>
                    <p>Manual open market: {attributionPreview.exchangeRateProviderStatus.manualOpenMarket?.status || "—"} · audited corrections only</p>
                    <p>Sarafi.af: {attributionPreview.exchangeRateProviderStatus.sarafiAf?.status || "—"} · {attributionPreview.exchangeRateProviderStatus.sarafiAf?.reason || "—"}</p>
                  </div>
                )}
                {attributionPreview.historicalPoolPreview.blockedReasons?.length > 0 && (
                  <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-red-700">
                    {attributionPreview.historicalPoolPreview.blockedReasons.map((reason: string) => <p key={reason}>{reason}</p>)}
                  </div>
                )}
                {attributionPreview.unsupportedFxPositions?.length > 0 && (
                  <div className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800">
                    <p className="font-semibold">Unsupported FX positions</p>
                    {attributionPreview.unsupportedFxPositions.slice(0, 4).map((row: any) => (
                      <p key={row.sourcePosition}>{row.currencyCode} {formatNumber(row.foreignAmount)} · {row.intermediaryName} · {row.reason}</p>
                    ))}
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-indigo-100 bg-white/70 p-2">
                    <p className="mb-1 font-semibold">Stable pools</p>
                    <div className="space-y-1">
                      {(attributionPreview.historicalPoolPreview.pools || []).slice(0, 4).map((pool: any) => (
                        <div key={pool.poolId} className="rounded-md bg-white px-2 py-1">
                          <p className="font-mono text-[10px] text-indigo-700">{pool.poolId.slice(0, 72)}{pool.poolId.length > 72 ? "…" : ""}</p>
                          <p className="text-indigo-900">{pool.segmentStart} → {pool.segmentEnd} · PKR {formatNumber(pool.totalCapitalPkr)}</p>
                        </div>
                      ))}
                      {(!attributionPreview.historicalPoolPreview.pools || attributionPreview.historicalPoolPreview.pools.length === 0) && <p className="text-indigo-700">No historical pools found.</p>}
                    </div>
                  </div>
                  <div className="rounded-lg border border-indigo-100 bg-white/70 p-2">
                    <p className="mb-1 font-semibold">Residual manager assumptions</p>
                    <div className="space-y-1">
                      {(attributionPreview.historicalPoolPreview.residualTransfers || []).slice(0, 4).map((row: any) => (
                        <div key={`${row.poolId}-${row.sourceType}-${row.sourceId}-${row.originalParticipantId}`} className="rounded-md bg-white px-2 py-1">
                          <p>{row.originalParticipantName} → {row.managerParticipantName}</p>
                          <p className={Number(row.managerAssumptionPkr || 0) < 0 ? "text-red-700" : "text-emerald-700"}>PKR {formatNumber(row.managerAssumptionPkr)} · {row.sourceType}</p>
                        </div>
                      ))}
                      {(!attributionPreview.historicalPoolPreview.residualTransfers || attributionPreview.historicalPoolPreview.residualTransfers.length === 0) && <p className="text-indigo-700">No exited-investor residual assumptions in this period.</p>}
                    </div>
                  </div>
                </div>
                <div className="mt-2 overflow-x-auto rounded-lg border border-indigo-100 bg-white/70">
                  <table className="min-w-full text-left text-[11px]">
                    <thead className="text-indigo-700">
                      <tr><th className="px-2 py-1.5">Source</th><th className="px-2 py-1.5">Recognized</th><th className="px-2 py-1.5">Original Pool</th><th className="px-2 py-1.5">Amount</th><th className="px-2 py-1.5">Residual</th><th className="px-2 py-1.5">Recon</th><th className="px-2 py-1.5">FX</th><th className="px-2 py-1.5">Audit</th></tr>
                    </thead>
                    <tbody className="divide-y divide-indigo-100">
                      {(attributionPreview.historicalPoolPreview.transactionLinks || []).slice(0, 8).map((row: any) => (
                        <tr key={`${row.sourceType}-${row.sourceId}`}>
                          <td className="px-2 py-1.5">{row.sourceType}<br /><span className="font-mono text-[10px] text-indigo-500">{row.sourceId}</span></td>
                          <td className="px-2 py-1.5">{row.recognizedDate}</td>
                          <td className="px-2 py-1.5">{row.poolSegmentStart ? `${row.poolSegmentStart} → ${row.poolSegmentEnd}` : "No pool"}</td>
                          <td className="px-2 py-1.5">PKR {formatNumber(row.amountPkr)}</td>
                          <td className="px-2 py-1.5">PKR {formatNumber(row.residualAttributionPkr ?? 0)}</td>
                          <td className="px-2 py-1.5">PKR {formatNumber(row.reconciliationDifferencePkr ?? 0)}</td>
                          <td className="px-2 py-1.5">
                            {row.fx ? (
                              <span>
                                {row.fx.currencyCode} {formatNumber(row.fx.foreignAmount)} · {row.fx.provider || "—"} {row.fx.market || ""} · {row.fx.selectedRateType || "rate"} · {formatNumber(row.fx.carryingRate)} → {row.fx.valuationRate == null ? "missing" : formatNumber(row.fx.valuationRate)}
                                {row.fx.conversionPath?.length ? <><br /><span className="text-indigo-500">{row.fx.conversionPath.join(" → ")}</span></> : null}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="px-2 py-1.5">
                            <p>{row.description || "—"}</p>
                            <p className="text-indigo-600">
                              {(row.attribution || []).map((line: any) => `${line.participantName} ${line.participantStatus} ${formatNumber(line.attributablePkr)}${line.assumedByManager ? ` → ${line.finalRecipientName}` : ""}`).join(" · ")}
                            </p>
                          </td>
                        </tr>
                      ))}
                      {(!attributionPreview.historicalPoolPreview.transactionLinks || attributionPreview.historicalPoolPreview.transactionLinks.length === 0) && (
                        <tr><td colSpan={8} className="px-2 py-3 text-center text-indigo-700">No recognized profit/loss transactions linked for this period.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <div className="overflow-x-auto rounded-xl border border-gray-100">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Participant</th>
                    <th className="px-3 py-2">Capital</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Entitlement</th>
                    <th className="px-3 py-2">Own Capital</th>
                    <th className="px-3 py-2">Manager Share</th>
                    <th className="px-3 py-2">Loss</th>
                    <th className="px-3 py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(attributionPreview.participantSummary || []).map((row: any) => (
                    <tr key={row.participantId}>
                      <td className="px-3 py-2 font-medium text-gray-800">{row.participantName}</td>
                      <td className="px-3 py-2">PKR {formatNumber(row.capitalPkr)}</td>
                      <td className="px-3 py-2 capitalize">{row.participantType}</td>
                      <td className="px-3 py-2">PKR {formatNumber(row.investorEntitlementPkr)}</td>
                      <td className="px-3 py-2">PKR {formatNumber(row.managerOwnCapitalProfitPkr ?? 0)}</td>
                      <td className="px-3 py-2">PKR {formatNumber(row.managerSharePkr)}</td>
                      <td className="px-3 py-2">PKR {formatNumber(row.allocatedLossPkr ?? 0)}</td>
                      <td className="px-3 py-2 font-semibold">PKR {formatNumber(row.totalAttributedPkr)}</td>
                    </tr>
                  ))}
                  {(!attributionPreview.participantSummary || attributionPreview.participantSummary.length === 0) && (
                    <tr><td colSpan={8} className="px-3 py-4 text-center text-gray-400">No participating capital found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Participation segments</p>
              {(attributionPreview.segments || []).map((segment: any) => (
                <div key={`${segment.segmentStart}-${segment.segmentEnd}`} className="rounded-xl border border-gray-100 p-3">
                  <div className="mb-2 flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>{segment.segmentStart} → {segment.segmentEnd}</span>
                    <span>Pool: PKR {formatNumber(segment.totalCapitalPkr)}</span>
                    <span>Accounting: PKR {formatNumber(segment.businessProfitPkr)}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-[11px]">
                      <thead className="text-gray-400">
                        <tr><th className="py-1 pr-3">Participant</th><th className="py-1 pr-3">Capital</th><th className="py-1 pr-3">Pool %</th><th className="py-1 pr-3">Inv %</th><th className="py-1 pr-3">Mgr %</th><th className="py-1 pr-3">Attributable</th><th className="py-1 pr-3">Investor</th><th className="py-1 pr-3">Manager</th><th className="py-1 pr-3">Loss</th></tr>
                      </thead>
                      <tbody>
                        {(segment.lines || []).map((line: any) => (
                          <tr key={`${segment.segmentStart}-${line.participantId}`} className="border-t border-gray-50">
                            <td className="py-1 pr-3 font-medium text-gray-700">{line.participantName}</td>
                            <td className="py-1 pr-3">PKR {formatNumber(line.capitalPkr)}</td>
                            <td className="py-1 pr-3">{line.capitalPercent}%</td>
                            <td className="py-1 pr-3">{line.investorProfitSharePercent}%</td>
                            <td className="py-1 pr-3">{line.managerProfitSharePercent}%</td>
                            <td className="py-1 pr-3">PKR {formatNumber(line.attributablePkr)}</td>
                            <td className="py-1 pr-3">PKR {formatNumber(line.investorEntitlementPkr)}</td>
                            <td className="py-1 pr-3">PKR {formatNumber(line.managerSharePkr)}</td>
                            <td className="py-1 pr-3">PKR {formatNumber(line.allocatedLossPkr)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : investors.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No investors yet</p>
          <button onClick={openCreate} className="mt-3 text-sm text-violet-600 hover:underline">Add your first investor →</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Search size={40} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium">No investors match &ldquo;{search}&rdquo;</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50 overflow-hidden">
          {filtered.map(inv => {
            const capital = inv.accounts.reduce((s: number, a: any) => s + a.capital, 0);
            const sym = inv.accounts[0]?.currency?.symbol ?? "";
            const pending = isPendingInvestor(inv);
            return (
              <div
                key={inv.id}
                onClick={() => {
                  if (pending) return;
                  router.push(`/investors/${inv.id}`);
                }}
                className="flex items-center gap-3 px-5 py-4 hover:bg-gray-50/70 transition-colors cursor-pointer group"
              >
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold flex-shrink-0">
                  {inv.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm">{inv.name}</p>
                  {inv.relationship && <p className="text-xs text-gray-400">{inv.relationship}</p>}
                </div>
                <div className="text-right flex-shrink-0 mr-1">
                  <p className="text-sm font-bold text-emerald-700">{sym} {formatNumber(capital)}</p>
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Capital</p>
                </div>
                <div className="flex-shrink-0">
                  <RowActionMenu
                    open={openActionId === inv.id}
                    onOpenChange={(open) => setOpenActionId(open ? inv.id : null)}
                  >
                    <button onClick={() => { setOpenActionId(null); openEdit(inv); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-primary-700 hover:bg-primary-50 sm:py-2 sm:text-xs">Edit</button>
                    <button onClick={() => { setOpenActionId(null); openDelete(inv); }} className="w-full rounded-lg px-3 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 sm:py-2 sm:text-xs">Delete</button>
                  </RowActionMenu>
                </div>
                {!pending && <ChevronRight size={16} className="text-gray-300 flex-shrink-0" />}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create Investor Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full space-y-4 my-auto">
            <h3 className="font-semibold text-gray-900 text-lg">New Investor</h3>

            {/* Basic info */}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
                <input type="text" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={createForm.name} onChange={e => setCreateForm(p => ({ ...p, name: e.target.value }))} placeholder="Full name" autoFocus />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Relationship</label>
                  <input type="text" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={createForm.relationship} onChange={e => setCreateForm(p => ({ ...p, relationship: e.target.value }))} placeholder="Partner, Family…" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
                  <input type="text" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={createForm.phone} onChange={e => setCreateForm(p => ({ ...p, phone: e.target.value }))} placeholder="+92 300…" />
                </div>
              </div>
            </div>

            {/* Account setup */}
            <div className="border-t pt-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Investment Account</p>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Start Date *</label>
                <input type="date" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={createForm.startDate} onChange={e => setCreateForm(p => ({ ...p, startDate: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Initial Deposit <span className="text-gray-300 font-normal">(optional)</span></label>
                <input type="number" step="0.01" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={createForm.initialDeposit} onChange={e => setCreateForm(p => ({ ...p, initialDeposit: e.target.value }))} placeholder="0" onWheel={e => e.currentTarget.blur()} />
              </div>
            </div>

            {createError && <p className="text-xs text-red-500">{createError}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleCreate} disabled={creating} className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50">
                {creating ? "Creating…" : "Create Investor"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit Investor Modal ── */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full space-y-4">
            <h3 className="font-semibold text-gray-900">Edit Investor</h3>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Name *</label>
              <input type="text" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Relationship</label>
              <input type="text" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={editForm.relationship} onChange={e => setEditForm(p => ({ ...p, relationship: e.target.value }))} placeholder="e.g. Partner, Family…" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
              <input type="text" className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm outline-none focus:border-violet-400" value={editForm.phone} onChange={e => setEditForm(p => ({ ...p, phone: e.target.value }))} placeholder="+92 300 0000000" />
            </div>
            {editError && <p className="text-xs text-red-500">{editError}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setEditTarget(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleEditSave} disabled={editSaving} className="flex-1 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium disabled:opacity-50">
                {editSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Investor Modal ── */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full">
            <h3 className="font-semibold text-gray-900 mb-2">Delete Investor</h3>
            <p className="text-sm text-gray-500 mb-1">Delete <span className="font-medium text-gray-800">{deleteTarget.name}</span>?</p>
            <p className="text-xs text-gray-400 mb-4">Investors with existing transactions cannot be deleted.</p>
            {deleteError && <p className="text-xs text-red-500 mb-3">{deleteError}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setDeleteTarget(null); setDeleteError(""); }} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium disabled:opacity-50">
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
