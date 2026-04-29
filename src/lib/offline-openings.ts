type QueuedRequestLike = {
  id: string;
  url: string;
  method: string;
  body: string;
};

type OpeningDataLike = {
  currencies: { id: number; code: string; symbol: string }[];
  customers: { id: number; name: string }[];
  godowns: { id: number; name: string }[];
  products: { id: number; name: string }[];
  liabilityOptions: {
    suppliers: { id: number; name: string }[];
    shippingLines: { id: number; name: string }[];
    agents: { id: number; name: string; agentType: string }[];
    intermediaries: { id: number; name: string }[];
  };
  openingCash: any[];
  openingCustomerBalances: any[];
  openingStocks: any[];
  openingLiabilities: any[];
};

function safeParse(body: string): any {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

function findCurrencyCode(currencies: Array<{ id: number; code: string }>, currencyId: number) {
  return currencies.find((c) => c.id === currencyId)?.code || "";
}

export function applyPendingOpeningsData(base: OpeningDataLike, queuedItems: QueuedRequestLike[]): OpeningDataLike {
  const next: OpeningDataLike = {
    ...base,
    openingCash: [...(base.openingCash || [])],
    openingCustomerBalances: [...(base.openingCustomerBalances || [])],
    openingStocks: [...(base.openingStocks || [])],
    openingLiabilities: [...(base.openingLiabilities || [])],
  };

  for (const queued of queuedItems) {
    if (String(queued.method || "").toUpperCase() !== "POST") continue;
    if (queued.url !== "/api/v1/openings") continue;

    const parsed = safeParse(queued.body);
    const kind = String(parsed?.kind || "");

    if (kind === "cash") {
      const currencyId = Number(parsed?.currencyId || 0);
      next.openingCash.unshift({
        id: `pending-${queued.id}`,
        currencyId,
        currencyCode: findCurrencyCode(base.currencies || [], currencyId),
        amount: Number(parsed?.amount || 0),
        openingDate: parsed?.openingDate || new Date().toISOString().split("T")[0],
        notes: parsed?.notes || null,
        _pending: true,
      });
      continue;
    }

    if (kind === "customer") {
      const customerId = Number(parsed?.customerId || 0);
      const currencyId = Number(parsed?.currencyId || 0);
      next.openingCustomerBalances.unshift({
        id: `pending-${queued.id}`,
        customerId,
        customerName: (base.customers || []).find((c) => c.id === customerId)?.name || "Pending Customer",
        currencyId,
        currencyCode: findCurrencyCode(base.currencies || [], currencyId),
        amount: Number(parsed?.amount || 0),
        openingDate: parsed?.openingDate || new Date().toISOString().split("T")[0],
        notes: parsed?.notes || null,
        _pending: true,
      });
      continue;
    }

    if (kind === "stock") {
      const godownId = Number(parsed?.godownId || 0);
      const productId = Number(parsed?.productId || 0);
      next.openingStocks.unshift({
        id: `pending-${queued.id}`,
        godownId,
        godownName: (base.godowns || []).find((g) => g.id === godownId)?.name || "Pending Godown",
        productId,
        productName: (base.products || []).find((p) => p.id === productId)?.name || "Pending Product",
        qty: Number(parsed?.qty || 0),
        openingDate: parsed?.openingDate || new Date().toISOString().split("T")[0],
        notes: parsed?.notes || null,
        _pending: true,
      });
      continue;
    }

    if (kind === "liability") {
      const liabilityType = String(parsed?.liabilityType || "supplier");
      const partyId = Number(parsed?.partyId || 0);
      const currencyId = Number(parsed?.currencyId || 0);
      let partyName = "Pending Party";
      if (liabilityType === "supplier") partyName = (base.liabilityOptions?.suppliers || []).find((v) => v.id === partyId)?.name || partyName;
      else if (liabilityType === "shipping_line") partyName = (base.liabilityOptions?.shippingLines || []).find((v) => v.id === partyId)?.name || partyName;
      else if (liabilityType === "agent") partyName = (base.liabilityOptions?.agents || []).find((v) => v.id === partyId)?.name || partyName;
      else if (liabilityType === "intermediary") partyName = (base.liabilityOptions?.intermediaries || []).find((v) => v.id === partyId)?.name || partyName;
      next.openingLiabilities.unshift({
        id: `pending-${queued.id}`,
        liabilityType,
        partyId,
        partyName,
        currencyId,
        currencyCode: findCurrencyCode(base.currencies || [], currencyId),
        amount: Number(parsed?.amount || 0),
        openingDate: parsed?.openingDate || new Date().toISOString().split("T")[0],
        notes: parsed?.notes || null,
        _pending: true,
      });
    }
  }

  return next;
}
