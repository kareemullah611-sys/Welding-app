import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { assistantEntityLabel, redactAssistantDetail } from "@/lib/assistant-privacy";
import { clientErrorMessage } from "@/lib/client-error";
import { buildDateRange } from "@/lib/date-range";

const ASSISTANT_MAX_MESSAGE_LEN = 2000;
const ASSISTANT_MAX_HISTORY = 20;

// ─── DeepSeek (OpenAI-compatible, ~$1/month for typical usage) ───────────────
const AI_URL   = "https://api.deepseek.com/chat/completions";
const AI_MODEL = "deepseek-chat"; // DeepSeek-V3

function shouldShareAssistantFinancialContext(): boolean {
  return process.env.ASSISTANT_ALLOW_EXTERNAL_FINANCIAL_DATA === "true";
}

async function askGroq(
  apiKey: string,
  systemPrompt: string,
  history: { role: string; content: string }[],
  userMessage: string
): Promise<string> {
  const res = await fetch(AI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: userMessage },
      ],
      max_tokens: 2048,
      temperature: 0.1,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error(`DeepSeek API error ${res.status}:`, err);
    throw new Error(`DeepSeek API error ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || "No response";
}

// ─── Keyword detection helpers ───────────────────────────────────────────────
function lower(s: string) { return s.toLowerCase(); }
function has(msg: string, ...words: string[]) { return words.some(w => lower(msg).includes(w)); }

function parseDateRange(msg: string): { from: Date; toExclusive: Date; labelTo: Date } {
  const now = new Date();
  if (has(msg, "this month", "current month")) {
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), toExclusive: now, labelTo: now };
  }
  if (has(msg, "last month")) {
    const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    return { from: new Date(y, m, 1), toExclusive: new Date(y, m + 1, 1), labelTo: new Date(y, m + 1, 0) };
  }
  if (has(msg, "this year", "current year")) {
    return { from: new Date(now.getFullYear(), 0, 1), toExclusive: now, labelTo: now };
  }
  if (has(msg, "today")) {
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    return { from: start, toExclusive: now, labelTo: now };
  }
  if (has(msg, "this week")) {
    const day = now.getDay();
    const start = new Date(now); start.setDate(now.getDate() - day); start.setHours(0,0,0,0);
    return { from: start, toExclusive: now, labelTo: now };
  }
  // Try to parse explicit dates like "2026-01-01" or "January 2026"
  const dateMatch = msg.match(/(\d{4}-\d{2}-\d{2})/g);
  if (dateMatch?.length === 2) {
    const range = buildDateRange(dateMatch[0], dateMatch[1]);
    return { from: range.gte!, toExclusive: range.lt!, labelTo: new Date(`${dateMatch[1]}T00:00:00.000Z`) };
  }
  if (dateMatch?.length === 1) return { from: new Date(dateMatch[0]), toExclusive: now, labelTo: now };
  // Default: current month
  return { from: new Date(now.getFullYear(), now.getMonth(), 1), toExclusive: now, labelTo: now };
}

// ─── Data fetchers ────────────────────────────────────────────────────────────
async function fetchFinancialSummary(msg: string) {
  const { from, toExclusive, labelTo } = parseDateRange(msg);
  const [sales, payments, expenses, hajiTransfers, withdrawals] = await Promise.all([
    prisma.sale.aggregate({ where: { status: "active", saleDate: { gte: from, lt: toExclusive } }, _sum: { totalAmount: true }, _count: true }),
    prisma.payment.aggregate({ where: { status: "active", paymentDate: { gte: from, lt: toExclusive } }, _sum: { amount: true }, _count: true }),
    prisma.expense.aggregate({ where: { deletedAt: null, expenseDate: { gte: from, lt: toExclusive } }, _sum: { amount: true }, _count: true }),
    prisma.hajiTransfer.aggregate({
      where: { withdrawalSource: null, transferDate: { gte: from, lt: toExclusive } },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.personalWithdrawal.aggregate({ where: { withdrawalDate: { gte: from, lt: toExclusive } }, _sum: { amount: true }, _count: true }),
  ]);
  const period = `${from.toISOString().split("T")[0]} to ${labelTo.toISOString().split("T")[0]}`;
  return `FINANCIAL SUMMARY (${period}):\n- Sales: $${Number(sales._sum.totalAmount||0).toLocaleString()} (${sales._count} transactions)\n- Payments Received: $${Number(payments._sum.amount||0).toLocaleString()} (${payments._count})\n- Expenses: $${Number(expenses._sum.amount||0).toLocaleString()} (${expenses._count})\n- Haji Transfers: $${Number(hajiTransfers._sum.amount||0).toLocaleString()} (${hajiTransfers._count})\n- Withdrawals: $${Number(withdrawals._sum.amount||0).toLocaleString()} (${withdrawals._count})`;
}

async function fetchWithdrawals(msg: string) {
  const { from, toExclusive } = parseDateRange(msg);
  const rows = await prisma.personalWithdrawal.findMany({
    where: { withdrawalDate: { gte: from, lt: toExclusive } },
    include: { currency: { select: { symbol: true } } },
    orderBy: { withdrawalDate: "desc" }, take: 50,
  });
  if (!rows.length) return "No withdrawals found for the specified period.";
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const lines = rows.map(r => `• ${r.withdrawalDate.toISOString().split("T")[0]} | ${assistantEntityLabel("Withdrawal", r.id)} | ${r.currency.symbol}${Number(r.amount).toLocaleString()} | ${r.approvedBy?"Approved":"Pending"}`);
  return `WITHDRAWALS (${rows.length} records, Total: ${rows[0]?.currency?.symbol||""}${total.toLocaleString()}):\n${lines.join("\n")}`;
}

async function fetchPayments(msg: string) {
  const { from, toExclusive } = parseDateRange(msg);
  const rows = await prisma.payment.findMany({
    where: { status: "active", paymentDate: { gte: from, lt: toExclusive } },
    include: { customer: { select: { id: true } }, currency: { select: { symbol: true, code: true } }, city: { select: { id: true } } },
    orderBy: { paymentDate: "desc" }, take: 50,
  });
  if (!rows.length) return "No payments found for the specified period.";
  const totalUsd = rows.reduce((s, r) => s + (r.usdEquivalent ? Number(r.usdEquivalent) : (r.currency.code==="USD" ? Number(r.amount) : 0)), 0);
  const lines = rows.map(r => `• ${r.paymentDate.toISOString().split("T")[0]} | ${r.customer ? assistantEntityLabel("Customer", r.customer.id) : "—"} | City-${(r as any).city?.id||"—"} | ${r.currency.symbol}${Number(r.amount).toLocaleString()} | ${r.paymentMethod}`);
  return `PAYMENTS (${rows.length} records, Total USD equiv: $${totalUsd.toLocaleString()}):\n${lines.join("\n")}`;
}

async function fetchSales(msg: string) {
  const { from, toExclusive } = parseDateRange(msg);
  const rows = await prisma.sale.findMany({
    where: { status: "active", saleDate: { gte: from, lt: toExclusive } },
    include: { customer: { select: { id: true } }, city: { select: { id: true } }, lot: { select: { lotNumber: true } } },
    orderBy: { saleDate: "desc" }, take: 50,
  });
  if (!rows.length) return "No sales found for the specified period.";
  const total = rows.reduce((s, r) => s + Number(r.totalAmount), 0);
  const lines = rows.map(r => `• ${r.saleDate.toISOString().split("T")[0]} | ${r.customer ? assistantEntityLabel("Customer", r.customer.id) : "—"} | City-${(r as any).city?.id||"—"} | $${Number(r.totalAmount).toLocaleString()} | Lot: ${(r as any).lot?.lotNumber||"—"}`);
  return `SALES (${rows.length} records, Total: $${total.toLocaleString()}):\n${lines.join("\n")}`;
}

async function fetchExpenses(msg: string) {
  const { from, toExclusive } = parseDateRange(msg);
  const rows = await prisma.expense.findMany({
    where: { deletedAt: null, expenseDate: { gte: from, lt: toExclusive } },
    include: { currency: { select: { symbol: true } }, city: { select: { id: true } } },
    orderBy: { expenseDate: "desc" }, take: 50,
  });
  if (!rows.length) return "No expenses found for the specified period.";
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const lines = rows.map(r => `• ${r.expenseDate.toISOString().split("T")[0]} | City-${(r as any).city?.id||"—"} | ${r.currency.symbol}${Number(r.amount).toLocaleString()} | ${redactAssistantDetail(r.detail)}`);
  return `EXPENSES (${rows.length} records, Total: ${rows[0]?.currency?.symbol||""}${total.toLocaleString()}):\n${lines.join("\n")}`;
}

async function fetchHajiTransfers(msg: string) {
  const { from, toExclusive } = parseDateRange(msg);
  const rows = await prisma.hajiTransfer.findMany({
    where: { transferDate: { gte: from, lt: toExclusive } },
    include: { currency: { select: { symbol: true } }, city: { select: { id: true } } },
    orderBy: { transferDate: "desc" }, take: 50,
  });
  if (!rows.length) return "No haji transfers found for the specified period.";
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const lines = rows.map(r => `• ${r.transferDate.toISOString().split("T")[0]} | City-${(r as any).city?.id||"—"} | ${r.currency.symbol}${Number(r.amount).toLocaleString()} | ${r.transferType} | ${redactAssistantDetail(r.detail)}`);
  return `HAJI TRANSFERS (${rows.length} records, Total: ${rows[0]?.currency?.symbol||""}${total.toLocaleString()}):\n${lines.join("\n")}`;
}

async function fetchCustomerBalances(msg: string) {
  const customers = await prisma.customer.findMany({
    take: 100,
    include: {
      city:     { select: { id: true } },
      sales:    { where: { status: "active" }, select: { totalAmount: true } },
      payments: { where: { status: "active" }, select: { amount: true, usdEquivalent: true, currency: { select: { code: true } } } },
    },
  });
  const rows = customers.map(c => {
    const totalSales = c.sales.reduce((s: number, x: any) => s + Number(x.totalAmount), 0);
    const totalPaid  = c.payments.reduce((s: number, x: any) => x.currency.code==="USD" ? s+Number(x.amount) : s+(x.usdEquivalent?Number(x.usdEquivalent):0), 0);
    return { id: c.id, cityId: (c as any).city?.id||"—", totalSales, totalPaid, balance: totalSales - totalPaid };
  }).filter(r => r.balance > 0).sort((a, b) => b.balance - a.balance);
  if (!rows.length) return "No outstanding customer balances found.";
  const totalOwed = rows.reduce((s, r) => s + r.balance, 0);
  const lines = rows.map(r => `• ${assistantEntityLabel("Customer", r.id)} | City-${r.cityId} | Sales: $${r.totalSales.toLocaleString()} | Paid: $${r.totalPaid.toLocaleString()} | Balance: $${r.balance.toLocaleString()}`);
  return `CUSTOMER BALANCES (${rows.length} customers with balance, Total owed: $${totalOwed.toLocaleString()}):\n${lines.join("\n")}`;
}

async function fetchSupplierBalances() {
  const suppliers = await prisma.supplier.findMany({
    where: { isActive: true },
    include: { lotPurchases: { select: { totalPriceUsd: true } }, supplierPayments: { select: { amountUsd: true } } },
  });
  const rows = suppliers.map(s => {
    const purchased = s.lotPurchases.reduce((x: number, p: any) => x + Number(p.totalPriceUsd), 0);
    const paid      = s.supplierPayments.reduce((x: number, p: any) => x + Number(p.amountUsd), 0);
    return { id: s.id, country: s.country||"—", purchased, paid, balance: purchased - paid };
  }).sort((a, b) => b.balance - a.balance);
  if (!rows.length) return "No supplier data found.";
  const total = rows.reduce((s, r) => s + r.balance, 0);
  const lines = rows.map(r => `• ${assistantEntityLabel("Supplier", r.id)} | ${r.country} | Purchased: $${r.purchased.toLocaleString()} | Paid: $${r.paid.toLocaleString()} | Owed: $${r.balance.toLocaleString()}`);
  return `SUPPLIER BALANCES (${rows.length} suppliers, Total owed: $${total.toLocaleString()}):\n${lines.join("\n")}`;
}

async function fetchInventory() {
  const inventory: any[] = await prisma.$queryRaw`
    WITH received AS (
      SELECT lcga.godown_id, lcd.product_id, COALESCE(SUM(lcga.qty), 0) as qty
      FROM lot_city_godown_allocations lcga
      JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
      GROUP BY lcga.godown_id, lcd.product_id
    ),
    sold AS (
      SELECT s.godown_id, si.product_id, COALESCE(SUM(si.qty), 0) as qty
      FROM sale_items si JOIN sales s ON s.id = si.sale_id AND s.status = 'active'
      GROUP BY s.godown_id, si.product_id
    ),
    transferred_out AS (
      SELECT gt.from_godown_id as godown_id, gt.product_id, COALESCE(SUM(gt.qty), 0) as qty
      FROM godown_transfers gt GROUP BY gt.from_godown_id, gt.product_id
    ),
    transferred_in AS (
      SELECT gt.to_godown_id as godown_id, gt.product_id, COALESCE(SUM(gt.qty), 0) as qty
      FROM godown_transfers gt GROUP BY gt.to_godown_id, gt.product_id
    )
    SELECT c.id as city_id, p.id as product_id,
      SUM(COALESCE(r.qty,0) - COALESCE(s.qty,0) - COALESCE(tout.qty,0) + COALESCE(tin.qty,0)) as qty
    FROM godowns g
    JOIN cities c ON c.id = g.city_id
    CROSS JOIN products p
    LEFT JOIN received r ON r.godown_id = g.id AND r.product_id = p.id
    LEFT JOIN sold s ON s.godown_id = g.id AND s.product_id = p.id
    LEFT JOIN transferred_out tout ON tout.godown_id = g.id AND tout.product_id = p.id
    LEFT JOIN transferred_in tin ON tin.godown_id = g.id AND tin.product_id = p.id
    WHERE g.is_active = true AND p.is_active = true
    GROUP BY c.id, p.id
    HAVING SUM(COALESCE(r.qty,0) - COALESCE(s.qty,0) - COALESCE(tout.qty,0) + COALESCE(tin.qty,0)) > 0
    ORDER BY c.id, qty DESC
  `;
  if (!inventory.length) return "No inventory data found.";
  const total = inventory.reduce((s, r) => s + Number(r.qty), 0);
  const lines = inventory.map(r => `• Product-${r.product_id} | City-${r.city_id} | ${Number(r.qty).toLocaleString()} cartons`);
  return `INVENTORY (${inventory.length} lines, Grand total: ${total.toLocaleString()} cartons):\n${lines.join("\n")}`;
}

// ─── Smart context builder — picks which data to fetch based on the question ──
async function buildContext(msg: string): Promise<string> {
  const contexts: string[] = [];

  if (has(msg, "summary", "overview", "financial summary", "how much total", "overall")) {
    contexts.push(await fetchFinancialSummary(msg));
  }
  if (has(msg, "withdrawal", "withdrawn", "withdraw", "personal", "taken out")) {
    contexts.push(await fetchWithdrawals(msg));
  }
  if (has(msg, "payment", "received", "collected", "paid by customer")) {
    contexts.push(await fetchPayments(msg));
  }
  if (has(msg, "sale", "sold", "sales", "transaction")) {
    contexts.push(await fetchSales(msg));
  }
  if (has(msg, "expense", "cost", "spent", "spending")) {
    contexts.push(await fetchExpenses(msg));
  }
  if (has(msg, "haji", "transfer", "sent", "remittance")) {
    contexts.push(await fetchHajiTransfers(msg));
  }
  if (has(msg, "customer balance", "customer owes", "outstanding", "receivable", "who owes", "owe us")) {
    contexts.push(await fetchCustomerBalances(msg));
  }
  if (has(msg, "supplier", "vendor", "we owe", "payable")) {
    contexts.push(await fetchSupplierBalances());
  }
  if (has(msg, "inventory", "stock", "carton", "godown", "warehouse")) {
    contexts.push(await fetchInventory());
  }

  // Fallback: if nothing matched, give a full financial summary
  if (contexts.length === 0) {
    contexts.push(await fetchFinancialSummary(msg));
  }

  return contexts.join("\n\n");
}

// ─── Route Handler ────────────────────────────────────────────────────────────
export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") {
    return NextResponse.json({ error: "Superadmin only" }, { status: 403 });
  }

  if (process.env.NODE_ENV === "production" && process.env.ASSISTANT_ENABLED !== "true") {
    return NextResponse.json({ error: "Assistant is disabled in production" }, { status: 503 });
  }

  const limited = await checkRateLimit(`assistant:${user.userId}`, 30, 15 * 60 * 1000);
  if (limited) return limited;

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    const msg =
      process.env.NODE_ENV === "production"
        ? "Assistant is not configured"
        : "DEEPSEEK_API_KEY is not configured on the server.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  try {
    const { message, messages: clientHistory } = await request.json();
    if (typeof message !== "string" || !message.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    if (message.length > ASSISTANT_MAX_MESSAGE_LEN) {
      return NextResponse.json({ error: `Message too long (max ${ASSISTANT_MAX_MESSAGE_LEN} characters)` }, { status: 400 });
    }

    // 1. Fetch relevant data from DB only when explicitly allowed for external AI.
    const context = shouldShareAssistantFinancialContext()
      ? await buildContext(message)
      : "Live financial database context is disabled. Do not answer with live totals, balances, or transaction data.";

    // 2. Build conversation history for DeepSeek (so it remembers the chat)
    const history = (clientHistory || []).slice(-ASSISTANT_MAX_HISTORY).map((m: any) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: typeof m.content === "string" ? m.content.slice(0, ASSISTANT_MAX_MESSAGE_LEN) : "",
    }));

    // 3. Ask Groq to format/analyse the data
    const systemPrompt = `You are a smart business assistant for MRF Hardware Management System.

You are given REAL DATA fetched directly from the live database. Your job is to analyse it and answer the user's question clearly.
Entity labels like Customer-12 or Supplier-3 are internal IDs — do not invent real names for them.

Rules:
- Use bullet points and clear formatting
- Always include totals and counts from the data
- Be concise but complete
- Amounts are in USD unless stated otherwise
- "5 lacs" = 500,000 | "1 crore" = 10,000,000
- Remember the full conversation context when answering follow-up questions
- Today's date: ${new Date().toISOString().split("T")[0]}

LIVE DATABASE DATA (fetched for this query):
${context}`;

    const reply = await askGroq(apiKey, systemPrompt, history, message);
    return NextResponse.json({ reply });

  } catch (err: unknown) {
    console.error("Assistant error:", err);
    return NextResponse.json(
      { error: clientErrorMessage(err, "Assistant request failed") },
      { status: 500 },
    );
  }
});
