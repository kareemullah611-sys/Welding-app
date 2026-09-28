export type AccountFamily =
  | "cash"
  | "cheques_in_hand"
  | "bank"
  | "superadmin_bank"
  | "superadmin_cash"
  | "intermediary"
  | "intermediary_fx_clearing"
  | "superadmin_fx_clearing"
  | "inventory"
  | "customer_receivable"
  | "haji_receivable"
  | "advance_to_supplier"
  | "advance_to_shipping_line"
  | "advance_to_agent"
  | "supplier_payable"
  | "agent_payable"
  | "shipping_line_payable"
  | "intermediary_payable"
  | "city_payable"
  | "haji_payable"
  | "investor_settlement_payable"
  | "general_payable"
  | "sales_revenue"
  | "fx_gain"
  | "opening_balances"
  | "historical_stock_adjustment"
  | "manager_capital"
  | "retained_earnings"
  | "other_opening_equity"
  | "participant_capital"
  | "participant_current_profit"
  | "participant_ongoing_profit"
  | "owner_withdrawals"
  | "haji_account"
  | "cogs"
  | "customs_duty"
  | "freight"
  | "transport"
  | "port_charges"
  | "loading_unloading"
  | "insurance"
  | "customs_agent"
  | "clearing_agent"
  | "office_expenses"
  | "salaries"
  | "other_expenses"
  | "fx_loss"
  | "other";

export interface AccountFamilyDef {
  family: AccountFamily;
  label: string;
  accountType: string;
  sortOrder: number;
}

const FAMILY_DEFS: AccountFamilyDef[] = [
  { family: "cash", label: "Cash in Hand", accountType: "asset", sortOrder: 10 },
  { family: "cheques_in_hand", label: "Cheques in Hand", accountType: "asset", sortOrder: 20 },
  { family: "bank", label: "Bank Accounts", accountType: "asset", sortOrder: 30 },
  { family: "superadmin_bank", label: "Super Admin Bank", accountType: "asset", sortOrder: 40 },
  { family: "superadmin_cash", label: "Super Admin Cash", accountType: "asset", sortOrder: 50 },
  { family: "intermediary", label: "Intermediary Accounts", accountType: "asset", sortOrder: 60 },
  { family: "intermediary_fx_clearing", label: "Intermediary FX Clearing", accountType: "asset", sortOrder: 65 },
  { family: "superadmin_fx_clearing", label: "Superadmin FX Clearing", accountType: "asset", sortOrder: 67 },
  { family: "inventory", label: "Inventory", accountType: "asset", sortOrder: 70 },
  { family: "customer_receivable", label: "Accounts Receivable", accountType: "asset", sortOrder: 80 },
  { family: "haji_receivable", label: "Due from Haji", accountType: "asset", sortOrder: 90 },
  { family: "advance_to_supplier", label: "Advance to Supplier", accountType: "asset", sortOrder: 100 },
  { family: "advance_to_shipping_line", label: "Advance to Shipping Line", accountType: "asset", sortOrder: 110 },
  { family: "advance_to_agent", label: "Advance to Agent", accountType: "asset", sortOrder: 120 },
  { family: "supplier_payable", label: "Supplier Payable", accountType: "liability", sortOrder: 200 },
  { family: "agent_payable", label: "Agent Payable", accountType: "liability", sortOrder: 210 },
  { family: "shipping_line_payable", label: "Shipping Line Payable", accountType: "liability", sortOrder: 220 },
  { family: "intermediary_payable", label: "Intermediary Payable", accountType: "liability", sortOrder: 230 },
  { family: "city_payable", label: "City Payable", accountType: "liability", sortOrder: 240 },
  { family: "haji_payable", label: "Owed to Haji", accountType: "liability", sortOrder: 250 },
  { family: "investor_settlement_payable", label: "Investor Settlement Payable", accountType: "liability", sortOrder: 260 },
  { family: "general_payable", label: "General Payable", accountType: "liability", sortOrder: 290 },
  { family: "sales_revenue", label: "Sales Revenue", accountType: "revenue", sortOrder: 300 },
  { family: "fx_gain", label: "Foreign Exchange Gain", accountType: "revenue", sortOrder: 310 },
  { family: "opening_balances", label: "Opening Balances", accountType: "equity", sortOrder: 400 },
  { family: "historical_stock_adjustment", label: "Historical Stock Adjustment", accountType: "equity", sortOrder: 410 },
  { family: "manager_capital", label: "Opening Manager Capital", accountType: "equity", sortOrder: 420 },
  { family: "retained_earnings", label: "Opening Retained Earnings", accountType: "equity", sortOrder: 430 },
  { family: "other_opening_equity", label: "Other Opening Equity", accountType: "equity", sortOrder: 440 },
  { family: "participant_capital", label: "Participant Capital", accountType: "equity", sortOrder: 450 },
  { family: "participant_current_profit", label: "Participant Current-Year Profit", accountType: "equity", sortOrder: 460 },
  { family: "participant_ongoing_profit", label: "Participant Ongoing-Lot Profit", accountType: "equity", sortOrder: 470 },
  { family: "owner_withdrawals", label: "Owner Withdrawals", accountType: "equity", sortOrder: 480 },
  { family: "haji_account", label: "Haji Account", accountType: "equity", sortOrder: 490 },
  { family: "cogs", label: "Cost of Goods Sold", accountType: "cogs", sortOrder: 500 },
  { family: "customs_duty", label: "Customs Duty", accountType: "expense", sortOrder: 600 },
  { family: "freight", label: "Freight / Shipping", accountType: "expense", sortOrder: 610 },
  { family: "transport", label: "Transport", accountType: "expense", sortOrder: 620 },
  { family: "port_charges", label: "Port Charges", accountType: "expense", sortOrder: 630 },
  { family: "loading_unloading", label: "Loading / Unloading", accountType: "expense", sortOrder: 640 },
  { family: "insurance", label: "Insurance", accountType: "expense", sortOrder: 650 },
  { family: "customs_agent", label: "Customs Agent", accountType: "expense", sortOrder: 660 },
  { family: "clearing_agent", label: "Clearing Agent", accountType: "expense", sortOrder: 670 },
  { family: "office_expenses", label: "Office Expenses", accountType: "expense", sortOrder: 680 },
  { family: "salaries", label: "Salaries", accountType: "expense", sortOrder: 690 },
  { family: "other_expenses", label: "Other Expenses", accountType: "expense", sortOrder: 700 },
  { family: "fx_loss", label: "Foreign Exchange Loss", accountType: "expense", sortOrder: 710 },
  { family: "other", label: "Other / Unmapped", accountType: "asset", sortOrder: 9999 },
];

export const ACCOUNT_TYPE_ORDER: Record<string, number> = {
  asset: 1,
  liability: 2,
  equity: 3,
  revenue: 4,
  cogs: 5,
  expense: 6,
};

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  revenue: "Revenue",
  cogs: "Cost of Goods Sold",
  expense: "Expenses",
};

export function classifyAccount(code: string): AccountFamily {
  const c = code.toUpperCase();

  if (c === "FX-GAIN") return "fx_gain";
  if (c === "FX-LOSS") return "fx_loss";
  if (c === "1100") return "inventory";
  if (c === "2999") return "general_payable";
  if (c === "1050") return "bank";
  if (c === "1062-SAFX") return "superadmin_fx_clearing";

  if (c.startsWith("1001-CITY") || c === "1001-GENERAL") return "cash";
  if (c.startsWith("1002-CHEQUE")) return "cheques_in_hand";
  if (c.startsWith("1050-BANK")) return "bank";
  if (c.startsWith("1050-SABANK")) return "superadmin_bank";
  if (c.startsWith("1051-SACASH")) return "superadmin_cash";
  if (c.startsWith("1061-HFX")) return "intermediary_fx_clearing";
  if (c.startsWith("1060-H")) return "intermediary";
  if (c.startsWith("1200-C")) return "customer_receivable";
  if (c.startsWith("1250-H")) return "haji_receivable";
  if (c.startsWith("1250-S")) return "advance_to_supplier";
  if (c.startsWith("1260-SL")) return "advance_to_shipping_line";
  if (c.startsWith("1270-A")) return "advance_to_agent";

  if (c.startsWith("2100-S")) return "supplier_payable";
  if (c.startsWith("2200-A")) return "agent_payable";
  if (c.startsWith("2300-SL")) return "shipping_line_payable";
  if (c.startsWith("2350-I")) return "intermediary_payable";
  if (c.startsWith("2400-CL")) return "city_payable";
  if (c.startsWith("2450-H")) return "haji_payable";
  if (c.startsWith("2500-CADV")) return "customer_receivable";
  if (c === "2600-INVSETTLE") return "investor_settlement_payable";

  if (c === "3001") return "sales_revenue";
  if (c === "3900") return "opening_balances";
  if (c === "3901") return "historical_stock_adjustment";
  if (c === "3902") return "manager_capital";
  if (c === "3903") return "retained_earnings";
  if (c === "3904") return "other_opening_equity";
  if (c.startsWith("3905-P")) return "participant_capital";
  if (c.startsWith("3906-P")) return "participant_current_profit";
  if (c.startsWith("3907-P")) return "participant_ongoing_profit";
  if (c === "6002") return "owner_withdrawals";
  if (c === "6003") return "haji_account";

  if (c === "4001") return "cogs";

  if (c === "5001") return "customs_duty";
  if (c === "5002") return "freight";
  if (c === "5003") return "transport";
  if (c === "5004") return "port_charges";
  if (c === "5005") return "loading_unloading";
  if (c === "5006") return "insurance";
  if (c === "5007") return "customs_agent";
  if (c === "5008") return "clearing_agent";
  if (c === "5010") return "office_expenses";
  if (c === "5011") return "salaries";
  if (c === "5099") return "other_expenses";

  return "other";
}

export function getFamilyDef(family: AccountFamily): AccountFamilyDef {
  return FAMILY_DEFS.find((d) => d.family === family) || FAMILY_DEFS[FAMILY_DEFS.length - 1];
}

export function getAllFamilyDefs(): AccountFamilyDef[] {
  return [...FAMILY_DEFS];
}
