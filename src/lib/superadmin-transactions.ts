export type SuperAdminTransactionType =
  | "account_transfer"
  | "supplier_payment"
  | "shipping_payment"
  | "agent_payment"
  | "intermediary_deposit"
  | "intermediary_exchange"
  | "intermediary_receipt"
  | "liability_payment"
  | "liability_receive"
  | "liability_incurred"
  | "home_expense"
  | "lot_customs_duty"
  | "lot_transport_cost"
  | "lot_other_cost"
  | "investor_capital_withdrawal"
  | "manager_capital_withdrawal";

export type SuperAdminTransactionPrefill = {
  partyId?: number;
  sourceAccountId?: number;
  destinationAccountId?: number;
  lotId?: number;
};

export type SuperAdminTransactionOpenDetail = {
  type?: SuperAdminTransactionType;
  prefill?: SuperAdminTransactionPrefill;
  onSuccess?: () => void | Promise<void>;
};

export const SUPERADMIN_TRANSACTION_EVENT = "mrf:open-superadmin-transaction";

export function openSuperAdminTransaction(detail: SuperAdminTransactionOpenDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SuperAdminTransactionOpenDetail>(SUPERADMIN_TRANSACTION_EVENT, { detail }));
}

export const SUPERADMIN_TRANSACTION_GROUPS = [
  {
    key: "pay",
    label: "Pay someone",
    description: "Settle an existing business obligation",
    items: [
      { type: "supplier_payment", label: "Pay a Supplier", description: "Reduce a supplier liability" },
      { type: "shipping_payment", label: "Pay a Shipping Company", description: "Reduce a shipping liability" },
      { type: "agent_payment", label: "Pay an Agent", description: "Pay a customs or clearing agent" },
      { type: "liability_payment", label: "Pay a Lender or Payable", description: "Reduce an existing principal balance" },
      { type: "intermediary_deposit", label: "Send Money to an Intermediary", description: "Move funds into an intermediary balance" },
    ],
  },
  {
    key: "move",
    label: "Move or exchange money",
    description: "Transfer funds without recording an expense",
    items: [
      { type: "account_transfer", label: "Move Between My Accounts", description: "Transfer between Superadmin cash or bank accounts" },
      { type: "intermediary_exchange", label: "Exchange Currency", description: "Exchange currencies held by an intermediary" },
      { type: "intermediary_receipt", label: "Receive from an Intermediary", description: "Return intermediary funds to a Superadmin account" },
    ],
  },
  {
    key: "obligation",
    label: "Lenders and other payables",
    description: "Record money received, owed, or repaid",
    items: [
      { type: "liability_receive", label: "Receive Funds from a Lender", description: "Increase cash/bank and principal owed" },
      { type: "liability_incurred", label: "Record a New Amount Owed", description: "Increase a payable without moving money" },
    ],
  },
  {
    key: "expense",
    label: "Spending and lot costs",
    description: "Record Superadmin spending or an attributable landed cost",
    items: [
      { type: "home_expense", label: "Record a Home Expense", description: "Pay from a Superadmin cash or bank account" },
      { type: "lot_customs_duty", label: "Pay Customs Duty", description: "Add customs duty to a lot's landed cost" },
      { type: "lot_transport_cost", label: "Pay Lot Transport", description: "Add transport to a lot's landed cost" },
      { type: "lot_other_cost", label: "Add Other Lot Cost", description: "Add another attributable landed cost to a lot" },
    ],
  },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  description: string;
  items: ReadonlyArray<{ type: SuperAdminTransactionType; label: string; description: string }>;
}>;

export const DEFERRED_SUPERADMIN_TRANSACTIONS = [
  {
    type: "investor_capital_withdrawal",
    implementationStatus: "deferred",
    reason: "Requires a non-destructive historical investor settlement review and a purpose-built atomic capital withdrawal workflow.",
  },
  {
    type: "manager_capital_withdrawal",
    implementationStatus: "deferred",
    reason: "Requires the same audited capital-withdrawal workflow as investors.",
  },
] as const;

export function getSuperAdminTransactionLabel(type: SuperAdminTransactionType | null) {
  for (const group of SUPERADMIN_TRANSACTION_GROUPS) {
    const item = group.items.find((candidate) => candidate.type === type);
    if (item) return item.label;
  }
  return "New Transaction";
}
