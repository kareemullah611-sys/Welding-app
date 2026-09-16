"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Plus, Search } from "lucide-react";
import { Modal, MobileDateInput } from "@/components/ui";
import { FormattedNumberInput } from "@/components/ui/FormattedNumberInput";
import { apiCall } from "@/hooks/useApi";
import {
  SUPERADMIN_TRANSACTION_EVENT,
  SUPERADMIN_TRANSACTION_GROUPS,
  getSuperAdminTransactionLabel,
  type SuperAdminTransactionOpenDetail,
  type SuperAdminTransactionPrefill,
  type SuperAdminTransactionType,
} from "@/lib/superadmin-transactions";

type Step = "choose" | "form" | "review" | "success";
type ReferenceData = {
  suppliers: any[];
  shippingLines: any[];
  agents: any[];
  intermediaries: any[];
  liabilities: any[];
  lots: any[];
  currencies: any[];
  superAdminAccounts: any[];
  allFundingAccounts: any[];
  cities: any[];
  counterAccounts: any[];
};

const emptyReferenceData: ReferenceData = {
  suppliers: [], shippingLines: [], agents: [], intermediaries: [], liabilities: [], lots: [], currencies: [],
  superAdminAccounts: [], allFundingAccounts: [], cities: [], counterAccounts: [],
};

const today = () => new Date().toISOString().split("T")[0];

const emptyForm = () => ({
  date: today(), partyId: 0, lotId: 0, amount: "", sourceAccountId: "", destinationAccountId: "",
  intermediaryId: 0, currencyId: 0, toCurrencyId: 0, exchangeRate: "", rateSource: "",
  reference: "", notes: "", paymentMethod: "bank_transfer", paidVia: "account", counterAccountId: 0, cityId: 0,
});

function amountValue(value: unknown) {
  return Number(String(value ?? "").replaceAll(",", "")) || 0;
}

function accountLabel(account: any) {
  const scope = account.accountScope === "city" ? `${account.cityName} · ` : "";
  return `${scope}${account.accountKind === "cash" ? "Cash" : "Bank"} · ${account.bankName}${account.accountNumber ? ` (${account.accountNumber})` : ""} · ${account.currency?.code || "PKR"}`;
}

function accountKey(account: any) {
  return `${account.accountScope || "super_admin"}:${account.id}`;
}

function findAccount(rows: any[], key: string) {
  return rows.find((row) => accountKey(row) === key);
}

function partyLabel(rows: any[], id: number) {
  return rows.find((row) => Number(row.id) === Number(id))?.name || "selected party";
}

export default function SuperAdminTransactionModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [type, setType] = useState<SuperAdminTransactionType | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [prefill, setPrefill] = useState<SuperAdminTransactionPrefill>({});
  const [referenceData, setReferenceData] = useState<ReferenceData>(emptyReferenceData);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [onSuccess, setOnSuccess] = useState<SuperAdminTransactionOpenDetail["onSuccess"]>();
  const transferRequestRef = useRef<{ signature: string; requestId: string } | null>(null);

  const loadReferenceData = useCallback(async () => {
    setLoadingOptions(true);
    const [supplierResult, shippingResult, agentResult, intermediaryResult, lotResult, liabilityResult, liabilityOptionsResult] = await Promise.all([
      apiCall("/api/v1/suppliers", { params: { page: 1, limit: 100 } }),
      apiCall("/api/v1/shipping-lines", { params: { page: 1, limit: 100 } }),
      apiCall("/api/v1/agents", { params: { page: 1, limit: 100 } }),
      apiCall("/api/v1/intermediaries"),
      apiCall("/api/v1/lots", { params: { page: 1, limit: 100 } }),
      apiCall("/api/v1/super-admin-liabilities", { params: { page: 1, limit: 100 } }),
      apiCall("/api/v1/super-admin-liabilities/options"),
    ]);
    const optionData: any = liabilityOptionsResult.success ? liabilityOptionsResult.data || {} : {};
    const superAdminAccounts = (optionData.superAdminAccounts || []).map((account: any) => ({ ...account, accountScope: "super_admin" }));
    const cityAccounts = (optionData.cities || []).flatMap((city: any) => (city.bankAccounts || []).map((account: any) => ({
      ...account, cityId: city.id, cityName: city.name, accountScope: "city", accountKind: "bank", currency: { code: "PKR" },
    })));
    setReferenceData({
      suppliers: supplierResult.success ? supplierResult.data as any[] : [],
      shippingLines: shippingResult.success ? shippingResult.data as any[] : [],
      agents: agentResult.success ? agentResult.data as any[] : [],
      intermediaries: intermediaryResult.success ? intermediaryResult.data as any[] : [],
      lots: lotResult.success ? lotResult.data as any[] : [],
      liabilities: liabilityResult.success ? liabilityResult.data as any[] : [],
      currencies: optionData.currencies || [],
      superAdminAccounts,
      allFundingAccounts: [...superAdminAccounts, ...cityAccounts],
      cities: optionData.cities || [],
      counterAccounts: optionData.counterAccounts || [],
    });
    setLoadingOptions(false);
  }, []);

  const selectType = useCallback((nextType: SuperAdminTransactionType, nextPrefill: SuperAdminTransactionPrefill = prefill) => {
    transferRequestRef.current = null;
    setType(nextType);
    setForm({
      ...emptyForm(),
      partyId: Number(nextPrefill.partyId || 0),
      sourceAccountId: nextPrefill.sourceAccountId ? `super_admin:${nextPrefill.sourceAccountId}` : "",
      destinationAccountId: nextPrefill.destinationAccountId ? `super_admin:${nextPrefill.destinationAccountId}` : "",
      intermediaryId: ["intermediary_deposit", "intermediary_exchange", "intermediary_receipt"].includes(nextType) ? Number(nextPrefill.partyId || 0) : 0,
      lotId: Number(nextPrefill.lotId || 0),
      paidVia: nextType === "intermediary_exchange" ? "intermediary" : "account",
    });
    setError("");
    setStep("form");
  }, [prefill]);

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<SuperAdminTransactionOpenDetail>).detail || {};
      const nextPrefill = detail.prefill || {};
      setPrefill(nextPrefill);
      setOnSuccess(() => detail.onSuccess);
      setOpen(true);
      setSearch("");
      setError("");
      setSuccessMessage("");
      if (detail.type) selectType(detail.type, nextPrefill);
      else {
        setType(null);
        setForm(emptyForm());
        setStep("choose");
      }
      void loadReferenceData();
    };
    window.addEventListener(SUPERADMIN_TRANSACTION_EVENT, listener);
    return () => window.removeEventListener(SUPERADMIN_TRANSACTION_EVENT, listener);
  }, [loadReferenceData, selectType]);

  useEffect(() => {
    if (!type || !referenceData.currencies.length) return;
    const pkr = referenceData.currencies.find((currency) => currency.code === "PKR");
    setForm((current) => ({ ...current, currencyId: current.currencyId || pkr?.id || referenceData.currencies[0]?.id || 0 }));
  }, [referenceData.currencies, type]);

  useEffect(() => {
    if (type !== "agent_payment" || !form.partyId) return;
    const agent = referenceData.agents.find((row) => Number(row.id) === Number(form.partyId));
    if (agent?.city?.id && !form.cityId) setForm((current) => ({ ...current, cityId: Number(agent.city.id) }));
  }, [form.cityId, form.partyId, referenceData.agents, type]);

  const sourceAccount = findAccount(referenceData.allFundingAccounts, form.sourceAccountId);
  const destinationAccount = findAccount(referenceData.superAdminAccounts, form.destinationAccountId);
  const selectedCurrency = referenceData.currencies.find((row) => Number(row.id) === Number(form.currencyId));
  const toCurrency = referenceData.currencies.find((row) => Number(row.id) === Number(form.toCurrencyId));
  const selectedLiability = referenceData.liabilities.find((row) => Number(row.id) === Number(form.partyId));
  const selectedAgent = referenceData.agents.find((row) => Number(row.id) === Number(form.partyId));
  const liabilityAccountOptions = selectedLiability?.partyType === "creditor" && type === "liability_payment"
    ? referenceData.allFundingAccounts
    : referenceData.superAdminAccounts;
  const amount = amountValue(form.amount);
  const exchangeRate = amountValue(form.exchangeRate);
  const crossCurrencyTransfer = type === "account_transfer" && sourceAccount && destinationAccount && sourceAccount.currencyId !== destinationAccount.currencyId;
  const exchangeToAmount = type === "intermediary_exchange" && amount > 0 && exchangeRate > 0 ? Math.round(amount * exchangeRate * 100) / 100 : 0;

  const validate = () => {
    if (!type) return "Select a transaction type";
    if (!form.date) return "Date is required";
    if (!(amount > 0)) return "Enter an amount greater than zero";
    if (["supplier_payment", "shipping_payment", "agent_payment", "liability_payment", "liability_receive", "liability_incurred"].includes(type) && !form.partyId) return "Select the relevant party";
    if (["supplier_payment", "shipping_payment"].includes(type) && !form.lotId) return "Select the related lot";
    if (type === "account_transfer") {
      if (!form.sourceAccountId || !form.destinationAccountId) return "Select both accounts";
      if (form.sourceAccountId === form.destinationAccountId) return "From and To accounts must be different";
      if (crossCurrencyTransfer && (!(exchangeRate > 0) || !form.rateSource.trim())) return "Exchange rate and source are required";
    }
    if (["home_expense", "intermediary_deposit"].includes(type) && !form.sourceAccountId) return "Select the account money will leave";
    if (type === "home_expense" && !form.notes.trim()) return "Expense detail is required";
    if (["intermediary_deposit", "intermediary_exchange", "intermediary_receipt"].includes(type) && !form.intermediaryId) return "Select an intermediary";
    if (type === "intermediary_receipt" && !form.destinationAccountId) return "Select the account receiving the money";
    if (type === "intermediary_exchange") {
      if (!form.currencyId || !form.toCurrencyId || form.currencyId === form.toCurrencyId) return "Select two different currencies";
      if (!(exchangeRate > 0)) return "Enter the exchange rate";
    }
    if (["supplier_payment", "shipping_payment", "agent_payment"].includes(type)) {
      if (form.paidVia === "account" && !form.sourceAccountId) return "Select the funding account";
      if (form.paidVia === "intermediary" && !form.intermediaryId) return "Select the intermediary";
    }
    if (type === "agent_payment" && !form.cityId) return "Select the agent's city";
    if (["supplier_payment", "shipping_payment"].includes(type) && form.paidVia === "account" && !(exchangeRate > 0)) return "Documented settlement rate is required";
    if (["liability_payment", "liability_receive"].includes(type) && form.paidVia === "account" && !form.sourceAccountId) return type === "liability_receive" ? "Select the receiving account" : "Select the payment source";
    if (["liability_payment", "liability_receive"].includes(type) && form.paidVia === "intermediary" && !form.intermediaryId) return "Select the intermediary";
    if (type === "liability_incurred" && !form.counterAccountId) return "Select the counterpart account";
    if (["liability_payment", "liability_receive", "liability_incurred"].includes(type) && selectedCurrency?.code !== "PKR" && (!(exchangeRate > 0) || !form.rateSource.trim())) return "Rate to PKR and rate source are required";
    return "";
  };

  const reviewText = useMemo(() => {
    const formattedAmount = amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
    if (type === "account_transfer") {
      if (crossCurrencyTransfer) return `${sourceAccount?.currency?.code} ${formattedAmount} will leave ${sourceAccount?.bankName}; ${destinationAccount?.currency?.code} ${(amount * exchangeRate).toLocaleString("en-US", { maximumFractionDigits: 2 })} will enter ${destinationAccount?.bankName} at ${exchangeRate.toLocaleString("en-US")}.`;
      return `${sourceAccount?.currency?.code || ""} ${formattedAmount} will leave ${sourceAccount?.bankName || "the source account"} and enter ${destinationAccount?.bankName || "the destination account"}.`;
    }
    if (type === "supplier_payment") return `USD ${formattedAmount} will reduce ${partyLabel(referenceData.suppliers, form.partyId)}'s liability and be paid from ${form.paidVia === "intermediary" ? partyLabel(referenceData.intermediaries, form.intermediaryId) : sourceAccount?.bankName || "the selected account"}.`;
    if (type === "shipping_payment") return `USD ${formattedAmount} will reduce ${partyLabel(referenceData.shippingLines, form.partyId)}'s liability and be paid from ${form.paidVia === "intermediary" ? partyLabel(referenceData.intermediaries, form.intermediaryId) : sourceAccount?.bankName || "the selected account"}.`;
    if (type === "agent_payment") return `${sourceAccount?.currency?.code || selectedCurrency?.code || "PKR"} ${formattedAmount} will be paid to ${partyLabel(referenceData.agents, form.partyId)} from ${form.paidVia === "intermediary" ? partyLabel(referenceData.intermediaries, form.intermediaryId) : sourceAccount?.bankName || "the selected account"}.`;
    if (type === "intermediary_deposit") return `${sourceAccount?.currency?.code || ""} ${formattedAmount} will leave ${sourceAccount?.bankName || "the selected account"} and increase ${partyLabel(referenceData.intermediaries, form.intermediaryId)}'s balance.`;
    if (type === "intermediary_exchange") return `${selectedCurrency?.code || ""} ${formattedAmount} held with ${partyLabel(referenceData.intermediaries, form.intermediaryId)} will be exchanged for ${toCurrency?.code || ""} ${exchangeToAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })} at ${exchangeRate.toLocaleString("en-US")}.`;
    if (type === "intermediary_receipt") return `${destinationAccount?.currency?.code || ""} ${formattedAmount} will leave ${partyLabel(referenceData.intermediaries, form.intermediaryId)}'s balance and enter ${destinationAccount?.bankName || "the selected account"}.`;
    if (type === "liability_payment") return `${selectedCurrency?.code || ""} ${formattedAmount} will leave ${form.paidVia === "intermediary" ? partyLabel(referenceData.intermediaries, form.intermediaryId) : sourceAccount?.bankName || "the selected source"} and reduce the amount owed to ${partyLabel(referenceData.liabilities, form.partyId)}.`;
    if (type === "liability_receive") return `${selectedCurrency?.code || ""} ${formattedAmount} will enter ${form.paidVia === "intermediary" ? partyLabel(referenceData.intermediaries, form.intermediaryId) : sourceAccount?.bankName || "the selected account"} and increase principal owed to ${partyLabel(referenceData.liabilities, form.partyId)}.`;
    if (type === "liability_incurred") return `The amount owed to ${partyLabel(referenceData.liabilities, form.partyId)} will increase by ${selectedCurrency?.code || ""} ${formattedAmount}. No cash or bank balance changes now.`;
    if (type === "home_expense") return `${sourceAccount?.currency?.code || ""} ${formattedAmount} will leave ${sourceAccount?.bankName || "the selected account"} and be recorded as a home expense.`;
    return "";
  }, [amount, crossCurrencyTransfer, destinationAccount, exchangeRate, exchangeToAmount, form, referenceData, selectedCurrency, sourceAccount, toCurrency, type]);

  const fundingPayload = (accountId: string) => {
    const account = findAccount(referenceData.allFundingAccounts, accountId);
    if (!account) return {};
    if (account.accountScope === "city") return { bankAccountId: Number(account.id) };
    if (account.accountKind === "cash") return { superAdminCashAccountId: Number(account.id) };
    return { superAdminBankAccountId: Number(account.id) };
  };

  const liabilitySourcePayload = () => {
    if (form.paidVia === "intermediary") return { sourceType: "intermediary", intermediaryId: Number(form.intermediaryId) };
    const account = findAccount(referenceData.allFundingAccounts, form.sourceAccountId);
    if (!account) return {};
    if (account.accountScope === "city") return { sourceType: "city_bank", bankAccountId: account.id, cityId: account.cityId };
    if (account.accountKind === "cash") return { sourceType: "super_admin_cash", superAdminCashAccountId: account.id };
    return { sourceType: "super_admin_bank", superAdminBankAccountId: account.id };
  };

  const submit = async () => {
    if (!type) return;
    setSubmitting(true);
    setError("");
    let result: any;
    const commonReference = form.reference || undefined;
    if (type === "account_transfer") {
      const transferPayload = {
        transferDate: form.date, sourceAccountId: sourceAccount?.id, destinationAccountId: destinationAccount?.id,
        fromAmount: amount, toAmount: crossCurrencyTransfer ? Math.round(amount * exchangeRate * 100) / 100 : amount,
        exchangeRate: crossCurrencyTransfer ? exchangeRate : undefined, rateSource: crossCurrencyTransfer ? form.rateSource : undefined,
        reference: commonReference, notes: form.notes || undefined,
      };
      const signature = JSON.stringify(transferPayload);
      if (transferRequestRef.current?.signature !== signature) {
        transferRequestRef.current = { signature, requestId: `browser-${crypto.randomUUID()}` };
      }
      result = await apiCall("/api/v1/super-admin-account-transfers", {
        method: "POST",
        headers: { "x-sync-request-id": transferRequestRef.current.requestId },
        body: transferPayload,
      });
    } else if (type === "supplier_payment") {
      result = await apiCall("/api/v1/supplier-payments", { method: "POST", body: {
        supplierId: form.partyId, lotId: form.lotId, paymentDate: form.date, amountUsd: amount,
        paymentMethod: form.paymentMethod, reference: commonReference, notes: form.notes || undefined,
        ...(form.paidVia === "intermediary" ? { intermediaryId: form.intermediaryId } : { ...fundingPayload(form.sourceAccountId), exchangeRate, amountLocal: Math.round(amount * exchangeRate * 100) / 100 }),
      } });
    } else if (type === "shipping_payment") {
      result = await apiCall("/api/v1/shipping-line-payments", { method: "POST", body: {
        shippingLineId: form.partyId, lotId: form.lotId, paymentDate: form.date, amountUsd: amount,
        settlementCurrency: sourceAccount?.currency?.code || "USD", exchangeRate: form.paidVia === "intermediary" ? null : exchangeRate,
        ...(form.paidVia === "intermediary" ? { intermediaryId: form.intermediaryId } : fundingPayload(form.sourceAccountId)),
        reference: commonReference, notes: form.notes || null,
      } });
    } else if (type === "agent_payment") {
      const currencyCode = form.paidVia === "account" ? sourceAccount?.currency?.code || "PKR" : selectedCurrency?.code || "PKR";
      result = await apiCall("/api/v1/agent-payments", { method: "POST", body: {
        agentId: form.partyId, cityId: form.cityId, paymentDate: form.date, amount, currencyCode,
        paymentMethod: sourceAccount?.accountKind === "cash" ? "cash" : "bank_transfer", paidFrom: form.paidVia,
        ...(form.paidVia === "account" ? fundingPayload(form.sourceAccountId) : {}),
        ...(form.paidVia === "intermediary" ? { intermediaryId: form.intermediaryId } : {}), reference: commonReference,
      } });
    } else if (type === "intermediary_deposit") {
      result = await apiCall(`/api/v1/intermediaries/${form.intermediaryId}/deposits`, { method: "POST", body: {
        depositDate: form.date, amount, currencyId: sourceAccount?.currencyId, ...fundingPayload(form.sourceAccountId), notes: form.notes || null,
      } });
    } else if (type === "intermediary_exchange") {
      result = await apiCall(`/api/v1/intermediaries/${form.intermediaryId}/exchanges`, { method: "POST", body: {
        exchangeDate: form.date, baseCurrencyId: form.currencyId, quoteCurrencyId: form.toCurrencyId,
        fromCurrencyId: form.currencyId, toCurrencyId: form.toCurrencyId, fromAmount: amount, exchangeRate, notes: form.notes || null,
      } });
    } else if (type === "intermediary_receipt") {
      result = await apiCall("/api/v1/haji-cash-receipts", { method: "POST", body: {
        intermediaryId: form.intermediaryId, receiptDate: form.date, amount, ...fundingPayload(form.destinationAccountId), notes: form.notes || null,
      } });
    } else if (["liability_payment", "liability_receive", "liability_incurred"].includes(type)) {
      const entryType = type === "liability_payment" ? "payment" : type === "liability_receive" ? "loan_received" : "liability_incurred";
      result = await apiCall(`/api/v1/super-admin-liabilities/${form.partyId}/entries`, { method: "POST", body: {
        entryType, entryDate: form.date, currencyId: form.currencyId, amount,
        exchangeRateToPkr: selectedCurrency?.code === "PKR" ? undefined : exchangeRate,
        rateSource: selectedCurrency?.code === "PKR" ? undefined : form.rateSource,
        ...(type === "liability_incurred" ? { counterAccountId: form.counterAccountId } : liabilitySourcePayload()),
        reference: commonReference, remarks: form.notes || undefined,
      } });
    } else if (type === "home_expense") {
      result = await apiCall("/api/v1/super-admin-personal-expenses", { method: "POST", body: {
        expenseDate: form.date, detail: form.notes.trim(), amount, bankAccountId: sourceAccount?.id, notes: form.reference || undefined,
      } });
    }
    setSubmitting(false);
    if (!result?.success) return setError(result?.error || "Unable to record transaction");
    if (type === "account_transfer") transferRequestRef.current = null;
    setSuccessMessage(result.message || `${getSuperAdminTransactionLabel(type)} recorded successfully`);
    setStep("success");
    await onSuccess?.();
  };

  const continueToReview = () => {
    const validationError = validate();
    if (validationError) return setError(validationError);
    setError("");
    setStep("review");
  };

  const close = () => {
    if (submitting) return;
    setOpen(false);
    setStep("choose");
    setType(null);
    setForm(emptyForm());
    transferRequestRef.current = null;
    setOnSuccess(undefined);
  };

  const filteredGroups = SUPERADMIN_TRANSACTION_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => `${item.label} ${item.description}`.toLowerCase().includes(search.toLowerCase().trim())),
  })).filter((group) => group.items.length);

  return (
    <>
      <button type="button" onClick={() => {
        setOpen(true); setStep("choose"); setType(null); setSearch(""); setError(""); setForm(emptyForm()); setOnSuccess(undefined); transferRequestRef.current = null; void loadReferenceData();
      }} className="btn-primary inline-flex items-center gap-2 text-sm">
        <Plus className="h-4 w-4" /> New Transaction
      </button>
      <Modal open={open} onClose={close} title={step === "choose" ? "New Transaction" : getSuperAdminTransactionLabel(type)} size="xl" bodyClassName="min-h-[28rem]">
        {step === "choose" && (
          <div>
            <div className="mb-5">
              <h2 className="text-xl font-semibold text-gray-900">What would you like to record?</h2>
              <p className="mt-1 text-sm text-gray-500">Choose what happened. The system will show only the information needed.</p>
            </div>
            <label className="mb-5 flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 text-gray-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Find a transaction type" />
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              {filteredGroups.map((group) => (
                <section key={group.key} className="rounded-2xl border border-gray-200 bg-gray-50/70 p-3">
                  <h3 className="font-semibold text-gray-900">{group.label}</h3>
                  <p className="mb-3 text-xs text-gray-500">{group.description}</p>
                  <div className="space-y-2">
                    {group.items.map((item) => (
                      <button key={item.type} type="button" onClick={() => selectType(item.type)} className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-3 py-3 text-left transition hover:border-primary-300 hover:bg-primary-50">
                        <span><span className="block text-sm font-medium text-gray-900">{item.label}</span><span className="block text-xs text-gray-500">{item.description}</span></span>
                        <ArrowRight className="h-4 w-4 text-gray-400" />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        {step === "form" && type && (
          <div>
            {loadingOptions ? <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-700">Loading available accounts and parties…</div> : null}
            {error ? <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Date" required><MobileDateInput variant="field" value={form.date} onChange={(date) => setForm({ ...form, date })} /></Field>

              {type === "supplier_payment" && <PartySelect label="Supplier" rows={referenceData.suppliers} value={form.partyId} onChange={(partyId) => setForm({ ...form, partyId })} />}
              {type === "shipping_payment" && <PartySelect label="Shipping company" rows={referenceData.shippingLines} value={form.partyId} onChange={(partyId) => setForm({ ...form, partyId })} />}
              {type === "agent_payment" && <PartySelect label="Agent" rows={referenceData.agents} value={form.partyId} onChange={(partyId) => setForm({ ...form, partyId, cityId: Number(referenceData.agents.find((row) => Number(row.id) === partyId)?.city?.id || form.cityId) })} />}
              {["liability_payment", "liability_receive", "liability_incurred"].includes(type) && <PartySelect label="Lender / payable" rows={referenceData.liabilities} value={form.partyId} onChange={(partyId) => setForm({ ...form, partyId })} />}
              {["supplier_payment", "shipping_payment"].includes(type) && <Field label="Related lot" required><select className="select-field" value={form.lotId} onChange={(event) => setForm({ ...form, lotId: Number(event.target.value) })}><option value={0}>Select lot</option>{referenceData.lots.map((lot) => <option key={lot.id} value={lot.id}>{lot.lotNumber}</option>)}</select></Field>}

              <Field label={["supplier_payment", "shipping_payment"].includes(type) ? "Liability amount (USD)" : "Amount"} required><FormattedNumberInput className="input-field" value={form.amount} maxDecimalPlaces={2} onValueChange={(_, raw) => setForm({ ...form, amount: raw })} /></Field>

              {type === "account_transfer" && <><AccountSelect label="From" rows={referenceData.superAdminAccounts} value={form.sourceAccountId} onChange={(sourceAccountId) => setForm({ ...form, sourceAccountId })} /><AccountSelect label="To" rows={referenceData.superAdminAccounts.filter((row) => accountKey(row) !== form.sourceAccountId)} value={form.destinationAccountId} onChange={(destinationAccountId) => setForm({ ...form, destinationAccountId })} /></>}

              {["supplier_payment", "shipping_payment", "agent_payment"].includes(type) && <Field label="Pay using" required><select className="select-field" value={form.paidVia} onChange={(event) => setForm({ ...form, paidVia: event.target.value, sourceAccountId: "", intermediaryId: 0 })}><option value="account">Bank / cash account</option><option value="intermediary">Intermediary</option></select></Field>}
              {["supplier_payment", "shipping_payment", "agent_payment"].includes(type) && form.paidVia === "account" && <AccountSelect label="Paid from" rows={referenceData.allFundingAccounts} value={form.sourceAccountId} onChange={(sourceAccountId) => setForm({ ...form, sourceAccountId })} />}
              {["supplier_payment", "shipping_payment", "agent_payment"].includes(type) && form.paidVia === "intermediary" && <PartySelect label="Intermediary" rows={referenceData.intermediaries} value={form.intermediaryId} onChange={(intermediaryId) => setForm({ ...form, intermediaryId })} />}

              {type === "agent_payment" && !selectedAgent?.city?.id && <Field label="City" required><select className="select-field" value={form.cityId} onChange={(event) => setForm({ ...form, cityId: Number(event.target.value) })}><option value={0}>Select city</option>{referenceData.cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</select></Field>}
              {type === "agent_payment" && form.paidVia !== "account" && <CurrencySelect rows={referenceData.currencies} value={form.currencyId} onChange={(currencyId) => setForm({ ...form, currencyId })} />}

              {type === "intermediary_deposit" && <><PartySelect label="Intermediary" rows={referenceData.intermediaries} value={form.intermediaryId} onChange={(intermediaryId) => setForm({ ...form, intermediaryId })} /><AccountSelect label="Paid from" rows={referenceData.superAdminAccounts} value={form.sourceAccountId} onChange={(sourceAccountId) => setForm({ ...form, sourceAccountId })} /></>}
              {type === "intermediary_receipt" && <><PartySelect label="Intermediary" rows={referenceData.intermediaries} value={form.intermediaryId} onChange={(intermediaryId) => setForm({ ...form, intermediaryId })} /><AccountSelect label="Receive into" rows={referenceData.superAdminAccounts} value={form.destinationAccountId} onChange={(destinationAccountId) => setForm({ ...form, destinationAccountId })} /></>}
              {type === "intermediary_exchange" && <><PartySelect label="Intermediary" rows={referenceData.intermediaries} value={form.intermediaryId} onChange={(intermediaryId) => setForm({ ...form, intermediaryId })} /><CurrencySelect label="Currency given" rows={referenceData.currencies} value={form.currencyId} onChange={(currencyId) => setForm({ ...form, currencyId, toCurrencyId: form.toCurrencyId === currencyId ? 0 : form.toCurrencyId })} /><CurrencySelect label="Currency received" rows={referenceData.currencies.filter((row) => Number(row.id) !== Number(form.currencyId))} value={form.toCurrencyId} onChange={(toCurrencyId) => setForm({ ...form, toCurrencyId })} /></>}

              {["liability_payment", "liability_receive", "liability_incurred"].includes(type) && <CurrencySelect rows={referenceData.currencies} value={form.currencyId} onChange={(currencyId) => setForm({ ...form, currencyId })} />}
              {["liability_payment", "liability_receive"].includes(type) && <Field label={type === "liability_receive" ? "Receive through" : "Pay using"} required><select className="select-field" value={form.paidVia} onChange={(event) => setForm({ ...form, paidVia: event.target.value, sourceAccountId: "", intermediaryId: 0 })}><option value="account">Bank / cash account</option><option value="intermediary">Intermediary</option></select></Field>}
              {["liability_payment", "liability_receive"].includes(type) && form.paidVia === "account" && <AccountSelect label={type === "liability_receive" ? "Receive into" : "Paid from"} rows={liabilityAccountOptions} value={form.sourceAccountId} onChange={(sourceAccountId) => setForm({ ...form, sourceAccountId })} />}
              {["liability_payment", "liability_receive"].includes(type) && form.paidVia === "intermediary" && <PartySelect label="Intermediary" rows={referenceData.intermediaries} value={form.intermediaryId} onChange={(intermediaryId) => setForm({ ...form, intermediaryId })} />}
              {type === "liability_incurred" && <Field label="Related accounting account" required><select className="select-field" value={form.counterAccountId} onChange={(event) => setForm({ ...form, counterAccountId: Number(event.target.value) })}><option value={0}>Select account</option>{referenceData.counterAccounts.map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}</select></Field>}

              {type === "home_expense" && <AccountSelect label="Paid from" rows={referenceData.superAdminAccounts} value={form.sourceAccountId} onChange={(sourceAccountId) => setForm({ ...form, sourceAccountId })} />}
              {type === "home_expense" && <Field label="Expense detail" required><input className="input-field" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></Field>}

              {(crossCurrencyTransfer || type === "intermediary_exchange" || (["supplier_payment", "shipping_payment"].includes(type) && form.paidVia === "account") || (["liability_payment", "liability_receive", "liability_incurred"].includes(type) && selectedCurrency?.code !== "PKR")) && <Field label={type === "intermediary_exchange" ? `Rate (${toCurrency?.code || "received"} for 1 ${selectedCurrency?.code || "given"})` : "Exchange rate"} required><FormattedNumberInput className="input-field" value={form.exchangeRate} maxDecimalPlaces={6} onValueChange={(_, raw) => setForm({ ...form, exchangeRate: raw })} /></Field>}
              {(crossCurrencyTransfer || (["liability_payment", "liability_receive", "liability_incurred"].includes(type) && selectedCurrency?.code !== "PKR")) && <Field label="Rate source" required><input className="input-field" value={form.rateSource} onChange={(event) => setForm({ ...form, rateSource: event.target.value })} /></Field>}

              {type !== "home_expense" && <Field label="Reference"><input className="input-field" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></Field>}
              <Field label={type === "home_expense" ? "Additional notes" : "Notes"}><input className="input-field" value={type === "home_expense" ? form.reference : form.notes} onChange={(event) => type === "home_expense" ? setForm({ ...form, reference: event.target.value }) : setForm({ ...form, notes: event.target.value })} /></Field>
            </div>
            <div className="mt-6 flex items-center justify-between border-t pt-4"><button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm" onClick={() => setStep("choose")}><ArrowLeft className="h-4 w-4" /> Change type</button><button type="button" className="btn-primary text-sm" onClick={continueToReview}>Review transaction</button></div>
          </div>
        )}

        {step === "review" && (
          <div>
            <div className="rounded-2xl border border-primary-200 bg-primary-50/70 p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-700">Review financial effect</p>
              <p className="mt-3 text-lg leading-relaxed text-gray-900">{reviewText}</p>
              <p className="mt-3 text-sm text-gray-500">Date: {form.date}{form.reference ? ` · ${type === "home_expense" ? "Notes" : "Reference"}: ${form.reference}` : ""}</p>
            </div>
            {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
            <div className="mt-6 flex items-center justify-between border-t pt-4"><button type="button" className="btn-secondary inline-flex items-center gap-2 text-sm" onClick={() => setStep("form")}><ArrowLeft className="h-4 w-4" /> Edit details</button><button type="button" className="btn-primary text-sm" disabled={submitting} onClick={submit}>{submitting ? "Recording…" : "Confirm and record"}</button></div>
          </div>
        )}

        {step === "success" && (
          <div className="flex min-h-[24rem] flex-col items-center justify-center text-center">
            <CheckCircle2 className="h-16 w-16 text-emerald-600" />
            <h2 className="mt-4 text-2xl font-semibold text-gray-900">Transaction recorded</h2>
            <p className="mt-2 max-w-md text-sm text-gray-500">{successMessage}. It now appears in its existing professional ledger or module.</p>
            <div className="mt-6 flex gap-3"><button type="button" className="btn-secondary text-sm" onClick={close}>Close</button><button type="button" className="btn-primary text-sm" onClick={() => { setStep("choose"); setType(null); setForm(emptyForm()); setSearch(""); transferRequestRef.current = null; }}>Record another</button></div>
          </div>
        )}
      </Modal>
    </>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-sm font-medium text-gray-700">{label}{required ? " *" : ""}</label>{children}</div>;
}

function PartySelect({ label, rows, value, onChange }: { label: string; rows: any[]; value: number; onChange: (value: number) => void }) {
  return <Field label={label} required><select className="select-field" value={value} onChange={(event) => onChange(Number(event.target.value))}><option value={0}>Select {label.toLowerCase()}</option>{rows.filter((row) => row.isActive !== false).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>;
}

function AccountSelect({ label, rows, value, onChange }: { label: string; rows: any[]; value: string; onChange: (value: string) => void }) {
  return <Field label={label} required><select className="select-field" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Select account</option>{rows.filter((row) => row.isActive !== false).map((row) => <option key={accountKey(row)} value={accountKey(row)}>{accountLabel(row)}</option>)}</select></Field>;
}

function CurrencySelect({ label = "Currency", rows, value, onChange }: { label?: string; rows: any[]; value: number; onChange: (value: number) => void }) {
  return <Field label={label} required><select className="select-field" value={value} onChange={(event) => onChange(Number(event.target.value))}><option value={0}>Select currency</option>{rows.map((row) => <option key={row.id} value={row.id}>{row.code}</option>)}</select></Field>;
}
