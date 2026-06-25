"use client";

import React, { useState, useEffect } from "react";
import CustomerSearch from "@/components/CustomerSearch";
import { apiCall } from "@/hooks/useApi";
import { useAuth } from "@/hooks/useAuth";
import { useOffline } from "@/hooks/useOffline";
import { useLang } from "@/lib/lang";

type Props = {
  value: number;
  onChange: (id: number, name: string) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  /** City for the new customer — defaults to city admin scope or selected context city */
  cityId?: number | null;
};

export default function CustomerFieldWithNew({
  value,
  onChange,
  placeholder,
  label,
  required = true,
  cityId: cityIdProp,
}: Props) {
  const { user } = useAuth();
  const { isOnline, enqueue } = useOffline();
  const { t } = useLang();
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ name: "", phone: "" });
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedLabel, setSelectedLabel] = useState("");

  useEffect(() => {
    if (!value) setSelectedLabel("");
  }, [value]);

  const resolvedCityId =
    cityIdProp ||
    (user?.role === "city_admin" ? user.cityId : null) ||
    user?.cityId ||
    0;

  const resetNewForm = () => {
    setNewForm({ name: "", phone: "" });
    setFormError("");
    setShowNew(false);
  };

  const handleCustomerChange = (id: number, name: string) => {
    setSelectedLabel(name);
    onChange(id, name);
  };

  const handleCreate = async () => {
    const name = newForm.name.trim();
    if (!name) {
      setFormError("Name required");
      return;
    }
    if (!resolvedCityId) {
      setFormError("Select a godown first so we know which city this customer belongs to.");
      return;
    }

    const payload = {
      name,
      phone: newForm.phone.trim() || undefined,
      cityId: resolvedCityId,
    };

    setSubmitting(true);
    setFormError("");

    if (!isOnline) {
      const queueId = await enqueue({
        url: "/api/v1/customers",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        pathname: "/customers",
        auditMeta: {
          action: "create",
          entityType: "customer",
          entityLabel: "Customer (Pending)",
          entityDetail: name,
        },
      });
      setSubmitting(false);
      if (!queueId) {
        setFormError("Could not queue customer offline");
        return;
      }
      resetNewForm();
      return;
    }

    const result = await apiCall("/api/v1/customers", { method: "POST", body: payload });
    setSubmitting(false);
    if (!result.success) {
      setFormError(result.error || "Failed to create customer");
      return;
    }

    const created = result.data as { id: number; name: string };
    handleCustomerChange(created.id, created.name);
    resetNewForm();
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="block text-sm font-medium text-gray-700">
          {label ?? t("customer")}{required ? " *" : ""}
        </label>
        {!showNew && (
          <button
            type="button"
            onClick={() => {
              setFormError("");
              setShowNew(true);
            }}
            className="shrink-0 text-xs font-semibold text-primary-600 hover:text-primary-700 hover:underline"
          >
            + New
          </button>
        )}
      </div>

      {showNew && (
        <div className="mb-2 space-y-2 rounded-lg border border-primary-200 bg-primary-50/40 p-3">
          {formError && (
            <p className="text-xs text-red-600">{formError}</p>
          )}
          <input
            value={newForm.name}
            onChange={(e) => setNewForm((f) => ({ ...f, name: e.target.value }))}
            className="input-field"
            placeholder="Customer name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Escape") resetNewForm();
            }}
          />
          <input
            value={newForm.phone}
            onChange={(e) => setNewForm((f) => ({ ...f, phone: e.target.value }))}
            className="input-field"
            placeholder="Phone (optional)"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={submitting}
              className="btn-primary flex-1 text-sm"
              data-form-submit="true"
            >
              {submitting ? "Saving…" : t("create")}
            </button>
            <button
              type="button"
              onClick={resetNewForm}
              disabled={submitting}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <CustomerSearch
        value={value}
        onChange={handleCustomerChange}
        selectedLabel={selectedLabel}
        placeholder={placeholder ?? t("search_customer")}
      />
    </div>
  );
}
