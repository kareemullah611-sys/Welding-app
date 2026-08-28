type QueuedRequestLike = {
  url: string;
  method: string;
  body: string;
};

type ReceivableRow = { account: string; currency: string; balance: number };
type ReceivablesReportLike = {
  totalByCurrency?: Record<string, number>;
  netPositionByCurrency?: Record<string, number>;
  customerAdvancesByCurrency?: Record<string, number>;
  customers?: ReceivableRow[];
  customerAdvances?: ReceivableRow[];
};

type PayableRow = { account: string; currency: string; balance: number };
type PayablesReportLike = {
  suppliers?: PayableRow[];
  agents?: PayableRow[];
  shippingLines?: PayableRow[];
  intermediaries?: PayableRow[];
};

function safeParse(body: string): any {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

function addBucketTotal(bucket: Record<string, number>, currency: string, delta: number) {
  if (!delta) return;
  bucket[currency] = Number(bucket[currency] || 0) + delta;
}

function addLedgerRow(rows: Array<{ account: string; currency: string; balance: number }>, account: string, currency: string, delta: number) {
  if (!delta) return;
  const index = rows.findIndex((row) => row.account === account && row.currency === currency);
  if (index >= 0) {
    rows[index] = { ...rows[index], balance: Number(rows[index].balance || 0) + delta };
    return;
  }
  rows.push({ account, currency, balance: delta });
}

function resolveSaleAmount(parsed: any): number {
  const explicit = Number(parsed?.totalAmount || 0);
  if (explicit > 0) return explicit;
  if (!Array.isArray(parsed?.items)) return 0;
  return parsed.items.reduce((sum: number, item: any) => sum + Number(item?.qty || 0) * Number(item?.ratePerCarton || 0), 0);
}

export function applyPendingReceivablesReport(
  baseData: ReceivablesReportLike | null,
  queuedItems: QueuedRequestLike[]
): ReceivablesReportLike | null {
  if (!baseData) return baseData;
  const balances = [
    ...(baseData.customers || []).map((row) => ({ ...row })),
    ...(baseData.customerAdvances || []).map((row) => ({ ...row, balance: -Math.abs(row.balance) })),
  ];

  for (const queued of queuedItems) {
    if (String(queued.method || "").toUpperCase() !== "POST") continue;
    const parsed = safeParse(queued.body);
    const currency = String(parsed?.currencyCode || parsed?.currency || "PKR");

    if (queued.url === "/api/v1/sales") {
      const amount = resolveSaleAmount(parsed);
      if (amount <= 0) continue;
      const customerName = String(parsed?.customerName || parsed?.customer || "Offline Pending Customer");
      const account = `AR - ${customerName} (Pending)`;
      addLedgerRow(balances, account, currency, amount);
      continue;
    }

    if (queued.url === "/api/v1/payments") {
      const amount = Number(parsed?.amount || 0);
      if (amount <= 0) continue;
      const customerName = String(parsed?.customerName || parsed?.customer || "Offline Pending Customer");
      const account = `AR - ${customerName} (Pending)`;
      addLedgerRow(balances, account, currency, -amount);
    }
  }

  const customers: ReceivableRow[] = [];
  const customerAdvances: ReceivableRow[] = [];
  const totalByCurrency: Record<string, number> = {};
  const customerAdvancesByCurrency: Record<string, number> = {};
  const netPositionByCurrency: Record<string, number> = {};
  for (const row of balances) {
    const classified = classifyCustomerBalance(row.balance);
    addBucketTotal(netPositionByCurrency, row.currency, classified.net);
    if (classified.receivable > 0.5) {
      customers.push({ ...row, balance: classified.receivable });
      addBucketTotal(totalByCurrency, row.currency, classified.receivable);
    }
    if (classified.advance > 0.5) {
      customerAdvances.push({ ...row, balance: classified.advance });
      addBucketTotal(customerAdvancesByCurrency, row.currency, classified.advance);
    }
  }
  for (const currency of Object.keys(netPositionByCurrency)) {
    if (!(currency in totalByCurrency)) totalByCurrency[currency] = 0;
  }

  return { ...baseData, totalByCurrency, customers, customerAdvances, customerAdvancesByCurrency, netPositionByCurrency };
}

export function applyPendingPayablesReport(
  baseData: PayablesReportLike | null,
  queuedItems: QueuedRequestLike[]
): PayablesReportLike | null {
  if (!baseData) return baseData;
  const suppliers = [...(baseData.suppliers || [])];
  const agents = [...(baseData.agents || [])];
  const shippingLines = [...(baseData.shippingLines || [])];
  const intermediaries = [...(baseData.intermediaries || [])];

  for (const queued of queuedItems) {
    if (String(queued.method || "").toUpperCase() !== "POST") continue;
    const parsed = safeParse(queued.body);

    if (queued.url === "/api/v1/openings" && parsed?.kind === "liability") {
      const amount = Number(parsed?.amount || 0);
      if (amount <= 0) continue;
      const currency = String(parsed?.currencyCode || "USD");
      const partyName = String(parsed?.partyName || "Opening Party (Pending)");
      if (parsed?.liabilityType === "supplier") addLedgerRow(suppliers, partyName, currency, amount);
      else if (parsed?.liabilityType === "agent") addLedgerRow(agents, partyName, currency, amount);
      else if (parsed?.liabilityType === "shipping_line") addLedgerRow(shippingLines, partyName, currency, amount);
      continue;
    }

    if (queued.url === "/api/v1/lot-purchases") {
      const amount = Number(parsed?.totalPriceUsd || 0);
      if (amount <= 0) continue;
      const supplierName = String(parsed?.supplierName || "Supplier (Pending)");
      addLedgerRow(suppliers, supplierName, "USD", amount);
      continue;
    }

    if (queued.url === "/api/v1/supplier-payments") {
      const amount = Number(parsed?.amountUsd || 0);
      if (amount <= 0) continue;
      const supplierName = String(parsed?.supplierName || "Supplier (Pending)");
      addLedgerRow(suppliers, supplierName, "USD", -amount);
      continue;
    }

    if (queued.url === "/api/v1/agent-payments") {
      const amount = Number(parsed?.amount || 0);
      if (amount <= 0) continue;
      const currency = String(parsed?.currencyCode || parsed?.currency || "USD");
      const agentName = String(parsed?.agentName || "Agent (Pending)");
      addLedgerRow(agents, agentName, currency, -amount);
      continue;
    }

    if (queued.url === "/api/v1/shipping-line-payments") {
      const amount = Number(parsed?.amountUsd || 0);
      if (amount <= 0) continue;
      const shippingLineName = String(parsed?.shippingLineName || "Shipping Line (Pending)");
      addLedgerRow(shippingLines, shippingLineName, "USD", -amount);
    }
  }

  return { ...baseData, suppliers, agents, shippingLines, intermediaries };
}
import { classifyCustomerBalance } from "@/lib/customer-receivable-accounting";
