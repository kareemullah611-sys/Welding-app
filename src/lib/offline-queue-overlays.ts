type QueuedRequestLike = {
  id: string;
  url: string;
  method: string;
  body: string;
};

function safeParse(body: string): any {
  try {
    return JSON.parse(body || "{}");
  } catch {
    return {};
  }
}

export function getPendingCityTransfers(queuedItems: QueuedRequestLike[]) {
  return queuedItems
    .filter((q) => q.method === "POST" && q.url === "/api/v1/city-transfers")
    .map((q) => {
      const parsed = safeParse(q.body);
      return {
        id: `pending-${q.id}`,
        transferDate: parsed?.transferDate || new Date().toISOString().split("T")[0],
        qty: Number(parsed?.qty || 0),
        status: "pending",
        _pending: true,
        fromCity: { name: "Current City" },
        toCity: { name: "Pending" },
        fromGodown: { name: "Pending" },
        product: { name: "Pending Product" },
        lot: parsed?.lotId ? { lotNumber: `#${parsed.lotId}` } : null,
        sentBy: null,
      };
    });
}

export function getPendingBankDeposits(queuedItems: QueuedRequestLike[]) {
  return queuedItems
    .filter((q) => q.method === "POST" && q.url === "/api/v1/bank-deposits")
    .map((q) => {
      const parsed = safeParse(q.body);
      return {
        id: `pending-${q.id}`,
        depositDate: parsed?.depositDate || new Date().toISOString().split("T")[0],
        transferType: parsed?.transferType || "cheque_to_bank",
        slipNumber: parsed?.slipNumber || "",
        cashAmount: Number(parsed?.cashAmount || 0),
        notes: parsed?.notes || "",
        cheques: [],
        bankAccount: { bankName: "Pending Bank" },
        currency: { symbol: "" },
        _pending: true,
      };
    });
}

export function getPendingSuppliers(queuedItems: QueuedRequestLike[]) {
  return queuedItems
    .filter((q) => q.method === "POST" && q.url === "/api/v1/suppliers")
    .map((q) => {
      const parsed = safeParse(q.body);
      return {
        id: `pending-${q.id}`,
        name: parsed?.name || "Supplier",
        country: parsed?.country || "",
        contact: parsed?.contact || "",
        notes: parsed?.notes || "",
        isActive: true,
        _pending: true,
      };
    });
}

export function getPendingAgents(queuedItems: QueuedRequestLike[]) {
  return queuedItems
    .filter((q) => q.method === "POST" && q.url === "/api/v1/agents")
    .map((q) => {
      const parsed = safeParse(q.body);
      return {
        id: `pending-${q.id}`,
        name: parsed?.name || "Agent",
        agentType: parsed?.agentType || "other",
        city: { name: "Pending" },
        phone: parsed?.phone || "",
        _pending: true,
      };
    });
}

export function getPendingShippingLines(queuedItems: QueuedRequestLike[]) {
  return queuedItems
    .filter((q) => q.method === "POST" && q.url === "/api/v1/shipping-lines")
    .map((q) => {
      const parsed = safeParse(q.body);
      return {
        id: `pending-${q.id}`,
        name: parsed?.name || "Shipping Line",
        contact: parsed?.contact || "",
        notes: parsed?.notes || "",
        _pending: true,
      };
    });
}

export function getPendingGodowns(queuedItems: QueuedRequestLike[]) {
  return queuedItems
    .filter((q) => q.method === "POST" && q.url === "/api/v1/godowns")
    .map((q) => {
      const parsed = safeParse(q.body);
      return {
        id: `pending-${q.id}`,
        name: parsed?.name || "Godown",
        cityId: Number(parsed?.cityId || 0),
        cityName: "Pending",
        countryName: "",
        isActive: true,
        _pending: true,
      };
    });
}

export function getPendingInvestors(queuedItems: QueuedRequestLike[]) {
  return queuedItems
    .filter((q) => q.method === "POST" && q.url === "/api/v1/investors")
    .map((q) => {
      const parsed = safeParse(q.body);
      return {
        id: `pending-${q.id}`,
        name: parsed?.name || "Investor",
        relationship: parsed?.relationship || "",
        phone: parsed?.phone || "",
        accounts: [],
        _pending: true,
      };
    });
}

export function getPendingSuperAdminPersonalExpenses(queuedItems: QueuedRequestLike[]) {
  return queuedItems
    .filter((q) => q.method === "POST" && q.url === "/api/v1/super-admin-personal-expenses")
    .map((q) => {
      const parsed = safeParse(q.body);
      return {
        id: `pending-${q.id}`,
        expenseDate: parsed?.expenseDate || new Date().toISOString().split("T")[0],
        detail: parsed?.detail || "",
        amount: Number(parsed?.amount || 0),
        notes: parsed?.notes || "",
        bankAccountId: Number(parsed?.bankAccountId || 0),
        _pending: true,
      };
    });
}

export function getPendingLots(queuedItems: QueuedRequestLike[]) {
  return queuedItems
    .filter((q) => q.method === "POST" && q.url === "/api/v1/lots")
    .map((q) => {
      const parsed = safeParse(q.body);
      return {
        id: `pending-${q.id}`,
        lotNumber: parsed?.lotNumber || "Pending Lot",
        countryName: "Pending",
        lotDate: parsed?.lotDate || new Date().toISOString().split("T")[0],
        products: [],
        distributions: [],
        totalCartons: 0,
        soldCartons: 0,
        status: "pending",
        _pending: true,
      };
    });
}

export function getPendingIntermediaries(queuedItems: QueuedRequestLike[]) {
  return queuedItems
    .filter((q) => q.method === "POST" && q.url === "/api/v1/intermediaries")
    .map((q) => {
      const parsed = safeParse(q.body);
      return {
        id: `pending-${q.id}`,
        name: parsed?.name || "Intermediary",
        notes: parsed?.notes || "",
        isActive: true,
        _pending: true,
      };
    });
}

export function getPendingProducts(queuedItems: QueuedRequestLike[]) {
  return queuedItems
    .filter((q) => q.method === "POST" && q.url === "/api/v1/products")
    .map((q) => {
      const parsed = safeParse(q.body);
      return {
        id: `pending-${q.id}`,
        name: parsed?.name || "Product",
        isActive: true,
        _pending: true,
      };
    });
}

export function getPendingUsers(queuedItems: QueuedRequestLike[]) {
  return queuedItems
    .filter((q) => q.method === "POST" && q.url === "/api/v1/users")
    .map((q) => {
      const parsed = safeParse(q.body);
      return {
        id: `pending-${q.id}`,
        fullName: parsed?.fullName || "User",
        username: parsed?.username || "",
        role: parsed?.role || "city_admin",
        cityName: "Pending",
        isActive: true,
        _pending: true,
      };
    });
}
