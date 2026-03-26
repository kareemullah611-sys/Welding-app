import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { JWTPayload } from "@/lib/auth";

// ─── Groq REST helpers (OpenAI-compatible, free tier) ───────────────────────
const GROQ_URL   = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama3-groq-70b-8192-tool-use-preview"; // optimized for tool/function calling

async function callDeepSeek(
  apiKey: string,
  messages: object[],
  tools: object[]
): Promise<any> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      tools,
      tool_choice: "auto",
      max_tokens: 4096,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq API error ${res.status}: ${err}`);
  }
  return res.json();
}

// ─── Tool Definitions (OpenAI function-calling format) ──────────────────────
const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_withdrawals",
      description: "Query personal withdrawals. Filter by person name, date range, amount, status.",
      parameters: {
        type: "object",
        properties: {
          person_name:  { type: "string",  description: "Part of the withdrawn-by name (optional)" },
          from_date:    { type: "string",  description: "Start date YYYY-MM-DD (optional)" },
          to_date:      { type: "string",  description: "End date YYYY-MM-DD (optional)" },
          min_amount:   { type: "number",  description: "Minimum amount (optional)" },
          max_amount:   { type: "number",  description: "Maximum amount (optional)" },
          status:       { type: "string",  description: "'pending' or 'approved' (optional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_haji_transfers",
      description: "Query haji transfers (money sent to haji). Filter by date, amount, type, city.",
      parameters: {
        type: "object",
        properties: {
          from_date:     { type: "string",  description: "Start date YYYY-MM-DD (optional)" },
          to_date:       { type: "string",  description: "End date YYYY-MM-DD (optional)" },
          min_amount:    { type: "number",  description: "Minimum amount (optional)" },
          max_amount:    { type: "number",  description: "Maximum amount (optional)" },
          transfer_type: { type: "string",  description: "'from_in_hand' or 'direct' (optional)" },
          city_name:     { type: "string",  description: "Filter by city name (optional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_payments",
      description: "Query customer payments received. Filter by customer, city, date, amount, method.",
      parameters: {
        type: "object",
        properties: {
          customer_name:  { type: "string",  description: "Customer name (optional)" },
          city_name:      { type: "string",  description: "City name (optional)" },
          from_date:      { type: "string",  description: "Start date YYYY-MM-DD (optional)" },
          to_date:        { type: "string",  description: "End date YYYY-MM-DD (optional)" },
          min_amount:     { type: "number",  description: "Minimum amount (optional)" },
          max_amount:     { type: "number",  description: "Maximum amount (optional)" },
          status:         { type: "string",  description: "'active' or 'cancelled' (optional)" },
          payment_method: { type: "string",  description: "'cash','cheque','bank_transfer','online' (optional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sales",
      description: "Query sales transactions. Filter by customer, city, date range, lot number.",
      parameters: {
        type: "object",
        properties: {
          customer_name: { type: "string",  description: "Customer name (optional)" },
          city_name:     { type: "string",  description: "City name (optional)" },
          from_date:     { type: "string",  description: "Start date YYYY-MM-DD (optional)" },
          to_date:       { type: "string",  description: "End date YYYY-MM-DD (optional)" },
          lot_number:    { type: "string",  description: "Specific lot number (optional)" },
          min_amount:    { type: "number",  description: "Minimum total amount (optional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_expenses",
      description: "Query expenses. Filter by date, amount, description keyword, city.",
      parameters: {
        type: "object",
        properties: {
          from_date:   { type: "string",  description: "Start date YYYY-MM-DD (optional)" },
          to_date:     { type: "string",  description: "End date YYYY-MM-DD (optional)" },
          keyword:     { type: "string",  description: "Search in expense detail (optional)" },
          city_name:   { type: "string",  description: "City name (optional)" },
          min_amount:  { type: "number",  description: "Minimum amount (optional)" },
          max_amount:  { type: "number",  description: "Maximum amount (optional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_customer_balances",
      description: "Get customer outstanding balances — how much each customer owes.",
      parameters: {
        type: "object",
        properties: {
          customer_name:     { type: "string",  description: "Customer name (optional)" },
          city_name:         { type: "string",  description: "Filter by city (optional)" },
          only_with_balance: { type: "string",  description: "'true' to show only customers who owe money (optional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_supplier_balances",
      description: "Get supplier balances — how much is owed to each supplier.",
      parameters: {
        type: "object",
        properties: {
          supplier_name: { type: "string",  description: "Supplier name (optional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_inventory",
      description: "Get current inventory levels per product and city/godown.",
      parameters: {
        type: "object",
        properties: {
          product_name: { type: "string",  description: "Product name (optional)" },
          city_name:    { type: "string",  description: "City name (optional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_lots",
      description: "Get lot/shipment information including costs and products.",
      parameters: {
        type: "object",
        properties: {
          lot_number: { type: "string",  description: "Specific lot number (optional)" },
          status:     { type: "string",  description: "'open' or 'closed' (optional)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_financial_summary",
      description: "High-level financial summary: sales, payments, expenses, haji transfers, withdrawals.",
      parameters: {
        type: "object",
        properties: {
          from_date:  { type: "string",  description: "Start date YYYY-MM-DD (optional, defaults to current month)" },
          to_date:    { type: "string",  description: "End date YYYY-MM-DD (optional, defaults to today)" },
          city_name:  { type: "string",  description: "Filter by city (optional)" },
        },
      },
    },
  },
];

// ─── Tool Executor ──────────────────────────────────────────────────────────
async function executeTool(name: string, args: any): Promise<string> {
  try {
    switch (name) {

      case "get_withdrawals": {
        const where: any = { deletedAt: null };
        if (args.person_name) where.withdrawnBy = { contains: args.person_name, mode: "insensitive" };
        if (args.from_date || args.to_date) {
          where.withdrawalDate = {};
          if (args.from_date) where.withdrawalDate.gte = new Date(args.from_date);
          if (args.to_date)   where.withdrawalDate.lte = new Date(args.to_date + "T23:59:59");
        }
        if (args.min_amount) where.amount = { ...where.amount, gte: args.min_amount };
        if (args.max_amount) where.amount = { ...where.amount, lte: args.max_amount };
        if (args.status)     where.approvedBy = args.status === "approved" ? { not: null } : null;

        const rows = await prisma.personalWithdrawal.findMany({
          where, include: { currency: { select: { code: true, symbol: true } } },
          orderBy: { withdrawalDate: "desc" }, take: 50,
        });
        if (!rows.length) return "No withdrawals found.";
        const total = rows.reduce((s, r) => s + Number(r.amount), 0);
        const lines = rows.map(r =>
          `• ${r.withdrawalDate.toISOString().split("T")[0]} | ${r.withdrawnBy || "Unknown"} | ${r.currency.symbol}${Number(r.amount).toLocaleString()} | ${r.approvedBy ? "Approved" : "Pending"} | ${r.detail}`
        );
        return `Found ${rows.length} withdrawal(s). Total: ${rows[0]?.currency?.symbol || ""}${total.toLocaleString()}\n\n${lines.join("\n")}`;
      }

      case "get_haji_transfers": {
        const where: any = {};
        if (args.from_date || args.to_date) {
          where.transferDate = {};
          if (args.from_date) where.transferDate.gte = new Date(args.from_date);
          if (args.to_date)   where.transferDate.lte = new Date(args.to_date + "T23:59:59");
        }
        if (args.min_amount)    where.amount = { ...where.amount, gte: args.min_amount };
        if (args.max_amount)    where.amount = { ...where.amount, lte: args.max_amount };
        if (args.transfer_type) where.transferType = args.transfer_type;
        if (args.city_name) {
          const city = await prisma.city.findFirst({ where: { name: { contains: args.city_name, mode: "insensitive" } } });
          if (city) where.cityId = city.id;
        }
        const rows = await prisma.hajiTransfer.findMany({
          where, include: { currency: { select: { code: true, symbol: true } }, city: { select: { name: true } } },
          orderBy: { transferDate: "desc" }, take: 50,
        });
        if (!rows.length) return "No haji transfers found.";
        const total = rows.reduce((s, r) => s + Number(r.amount), 0);
        const lines = rows.map(r =>
          `• ${r.transferDate.toISOString().split("T")[0]} | ${(r as any).city?.name || "—"} | ${r.currency.symbol}${Number(r.amount).toLocaleString()} | ${r.transferType} | ${r.detail}`
        );
        return `Found ${rows.length} haji transfer(s). Total: ${rows[0]?.currency?.symbol || ""}${total.toLocaleString()}\n\n${lines.join("\n")}`;
      }

      case "get_payments": {
        const where: any = { status: "active" };
        if (args.status)         where.status = args.status;
        if (args.payment_method) where.paymentMethod = args.payment_method;
        if (args.from_date || args.to_date) {
          where.paymentDate = {};
          if (args.from_date) where.paymentDate.gte = new Date(args.from_date);
          if (args.to_date)   where.paymentDate.lte = new Date(args.to_date + "T23:59:59");
        }
        if (args.min_amount)    where.amount = { ...where.amount, gte: args.min_amount };
        if (args.max_amount)    where.amount = { ...where.amount, lte: args.max_amount };
        if (args.customer_name) where.customer = { name: { contains: args.customer_name, mode: "insensitive" } };
        if (args.city_name) {
          const city = await prisma.city.findFirst({ where: { name: { contains: args.city_name, mode: "insensitive" } } });
          if (city) where.cityId = city.id;
        }
        const rows = await prisma.payment.findMany({
          where, include: { customer: { select: { name: true } }, currency: { select: { code: true, symbol: true } }, city: { select: { name: true } } },
          orderBy: { paymentDate: "desc" }, take: 50,
        });
        if (!rows.length) return "No payments found.";
        const totalUsd = rows.reduce((s, r) => s + (r.usdEquivalent ? Number(r.usdEquivalent) : (r.currency.code === "USD" ? Number(r.amount) : 0)), 0);
        const lines = rows.map(r =>
          `• ${r.paymentDate.toISOString().split("T")[0]} | ${r.customer?.name || "—"} | ${(r as any).city?.name || "—"} | ${r.currency.symbol}${Number(r.amount).toLocaleString()} | ${r.paymentMethod} | ${r.detail}`
        );
        return `Found ${rows.length} payment(s). Total USD equiv: $${totalUsd.toLocaleString()}\n\n${lines.join("\n")}`;
      }

      case "get_sales": {
        const where: any = { status: "active" };
        if (args.from_date || args.to_date) {
          where.saleDate = {};
          if (args.from_date) where.saleDate.gte = new Date(args.from_date);
          if (args.to_date)   where.saleDate.lte = new Date(args.to_date + "T23:59:59");
        }
        if (args.customer_name) where.customer = { name: { contains: args.customer_name, mode: "insensitive" } };
        if (args.city_name) {
          const city = await prisma.city.findFirst({ where: { name: { contains: args.city_name, mode: "insensitive" } } });
          if (city) where.cityId = city.id;
        }
        if (args.lot_number) where.lot = { lotNumber: { contains: args.lot_number } };
        if (args.min_amount) where.totalAmount = { gte: args.min_amount };
        const rows = await prisma.sale.findMany({
          where, include: { customer: { select: { name: true } }, city: { select: { name: true } }, lot: { select: { lotNumber: true } }, items: { select: { qty: true, ratePerCarton: true } } },
          orderBy: { saleDate: "desc" }, take: 50,
        });
        if (!rows.length) return "No sales found.";
        const total = rows.reduce((s, r) => s + Number(r.totalAmount), 0);
        const totalCartons = rows.reduce((s, r) => s + r.items.reduce((x: number, i: any) => x + Number(i.qty), 0), 0);
        const lines = rows.map(r =>
          `• ${r.saleDate.toISOString().split("T")[0]} | ${r.customer?.name || "—"} | ${(r as any).city?.name || "—"} | $${Number(r.totalAmount).toLocaleString()} | Lot: ${(r as any).lot?.lotNumber || "—"} | ${r.items.reduce((x: number, i: any) => x + Number(i.qty), 0)} cartons`
        );
        return `Found ${rows.length} sale(s). Total: $${total.toLocaleString()} | Total Cartons: ${totalCartons}\n\n${lines.join("\n")}`;
      }

      case "get_expenses": {
        const where: any = { deletedAt: null };
        if (args.from_date || args.to_date) {
          where.expenseDate = {};
          if (args.from_date) where.expenseDate.gte = new Date(args.from_date);
          if (args.to_date)   where.expenseDate.lte = new Date(args.to_date + "T23:59:59");
        }
        if (args.keyword)    where.detail  = { contains: args.keyword, mode: "insensitive" };
        if (args.min_amount) where.amount  = { ...where.amount, gte: args.min_amount };
        if (args.max_amount) where.amount  = { ...where.amount, lte: args.max_amount };
        if (args.city_name) {
          const city = await prisma.city.findFirst({ where: { name: { contains: args.city_name, mode: "insensitive" } } });
          if (city) where.cityId = city.id;
        }
        const rows = await prisma.expense.findMany({
          where, include: { currency: { select: { code: true, symbol: true } }, city: { select: { name: true } } },
          orderBy: { expenseDate: "desc" }, take: 50,
        });
        if (!rows.length) return "No expenses found.";
        const total = rows.reduce((s, r) => s + Number(r.amount), 0);
        const lines = rows.map(r =>
          `• ${r.expenseDate.toISOString().split("T")[0]} | ${(r as any).city?.name || "—"} | ${r.currency.symbol}${Number(r.amount).toLocaleString()} | ${r.detail}`
        );
        return `Found ${rows.length} expense(s). Total: ${rows[0]?.currency?.symbol || ""}${total.toLocaleString()}\n\n${lines.join("\n")}`;
      }

      case "get_customer_balances": {
        const where: any = {};
        if (args.customer_name) where.name = { contains: args.customer_name, mode: "insensitive" };
        if (args.city_name) {
          const city = await prisma.city.findFirst({ where: { name: { contains: args.city_name, mode: "insensitive" } } });
          if (city) where.cityId = city.id;
        }
        const customers = await prisma.customer.findMany({
          where, take: 50,
          include: {
            city:     { select: { name: true } },
            sales:    { where: { status: "active" }, select: { totalAmount: true } },
            payments: { where: { status: "active" }, select: { amount: true, usdEquivalent: true, currency: { select: { code: true } } } },
          },
        });
        if (!customers.length) return "No customers found.";
        const rows = customers.map(c => {
          const totalSales = c.sales.reduce((s: number, x: any) => s + Number(x.totalAmount), 0);
          const totalPaid  = c.payments.reduce((s: number, x: any) => {
            if (x.currency.code === "USD") return s + Number(x.amount);
            return s + (x.usdEquivalent ? Number(x.usdEquivalent) : 0);
          }, 0);
          return { name: c.name, city: (c as any).city?.name || "—", totalSales, totalPaid, balance: totalSales - totalPaid };
        });
        const filtered = args.only_with_balance === "true" ? rows.filter(r => r.balance > 0) : rows;
        filtered.sort((a, b) => b.balance - a.balance);
        const lines = filtered.map(r =>
          `• ${r.name} | ${r.city} | Sales: $${r.totalSales.toLocaleString()} | Paid: $${r.totalPaid.toLocaleString()} | Balance: $${r.balance.toLocaleString()}`
        );
        return `${filtered.length} customer(s). Total outstanding: $${filtered.reduce((s, r) => s + r.balance, 0).toLocaleString()}\n\n${lines.join("\n")}`;
      }

      case "get_supplier_balances": {
        const where: any = { isActive: true };
        if (args.supplier_name) where.name = { contains: args.supplier_name, mode: "insensitive" };
        const suppliers = await prisma.supplier.findMany({
          where, include: { lotPurchases: { select: { totalPriceUsd: true } }, supplierPayments: { select: { amountUsd: true } } },
        });
        if (!suppliers.length) return "No suppliers found.";
        const rows = suppliers.map(s => {
          const totalPurchased = s.lotPurchases.reduce((x: number, p: any) => x + Number(p.totalPriceUsd), 0);
          const totalPaid      = s.supplierPayments.reduce((x: number, p: any) => x + Number(p.amountUsd), 0);
          return { name: s.name, country: s.country || "—", totalPurchased, totalPaid, balance: totalPurchased - totalPaid };
        }).sort((a, b) => b.balance - a.balance);
        const lines = rows.map(r =>
          `• ${r.name} | ${r.country} | Purchased: $${r.totalPurchased.toLocaleString()} | Paid: $${r.totalPaid.toLocaleString()} | Owed: $${r.balance.toLocaleString()}`
        );
        return `${rows.length} supplier(s). Total owed: $${rows.reduce((s, r) => s + r.balance, 0).toLocaleString()}\n\n${lines.join("\n")}`;
      }

      case "get_inventory": {
        const cityFilter = args.city_name
          ? await prisma.city.findFirst({ where: { name: { contains: args.city_name, mode: "insensitive" } } })
          : null;
        const cityId = cityFilter?.id ?? null;
        const inventory: any[] = await prisma.$queryRaw`
          WITH received AS (
            SELECT lcga.godown_id, lcd.product_id, COALESCE(SUM(lcga.qty), 0) as qty
            FROM lot_city_godown_allocations lcga
            JOIN lot_city_distributions lcd ON lcd.id = lcga.lot_city_distribution_id
            JOIN godowns g ON g.id = lcga.godown_id
            WHERE (${cityId}::int IS NULL OR g.city_id = ${cityId})
            GROUP BY lcga.godown_id, lcd.product_id
          ),
          sold AS (
            SELECT s.godown_id, si.product_id, COALESCE(SUM(si.qty), 0) as qty
            FROM sale_items si
            JOIN sales s ON s.id = si.sale_id AND s.status = 'active'
            WHERE (${cityId}::int IS NULL OR s.city_id = ${cityId})
            GROUP BY s.godown_id, si.product_id
          ),
          transferred_out AS (
            SELECT gt.from_godown_id as godown_id, gt.product_id, COALESCE(SUM(gt.qty), 0) as qty
            FROM godown_transfers gt JOIN godowns g ON g.id = gt.from_godown_id
            WHERE (${cityId}::int IS NULL OR g.city_id = ${cityId})
            GROUP BY gt.from_godown_id, gt.product_id
          ),
          transferred_in AS (
            SELECT gt.to_godown_id as godown_id, gt.product_id, COALESCE(SUM(gt.qty), 0) as qty
            FROM godown_transfers gt JOIN godowns g ON g.id = gt.to_godown_id
            WHERE (${cityId}::int IS NULL OR g.city_id = ${cityId})
            GROUP BY gt.to_godown_id, gt.product_id
          )
          SELECT c.name as city_name, p.name as product_name,
            SUM(COALESCE(r.qty,0) - COALESCE(s.qty,0) - COALESCE(tout.qty,0) + COALESCE(tin.qty,0)) as qty
          FROM godowns g
          JOIN cities c ON c.id = g.city_id
          CROSS JOIN products p
          LEFT JOIN received r ON r.godown_id = g.id AND r.product_id = p.id
          LEFT JOIN sold s ON s.godown_id = g.id AND s.product_id = p.id
          LEFT JOIN transferred_out tout ON tout.godown_id = g.id AND tout.product_id = p.id
          LEFT JOIN transferred_in tin ON tin.godown_id = g.id AND tin.product_id = p.id
          WHERE g.is_active = true AND p.is_active = true
            AND (${cityId}::int IS NULL OR g.city_id = ${cityId})
          GROUP BY c.name, p.name
          HAVING SUM(COALESCE(r.qty,0) - COALESCE(s.qty,0) - COALESCE(tout.qty,0) + COALESCE(tin.qty,0)) > 0
          ORDER BY c.name, p.name
        `;
        let rows = inventory.map(r => ({ city: r.city_name, product: r.product_name, qty: Number(r.qty) }));
        if (args.product_name) rows = rows.filter(r => r.product.toLowerCase().includes((args.product_name as string).toLowerCase()));
        rows.sort((a, b) => b.qty - a.qty);
        if (!rows.length) return "No inventory found.";
        const grandTotal = rows.reduce((s, r) => s + r.qty, 0);
        return `${rows.length} inventory line(s). Grand total: ${grandTotal.toLocaleString()} cartons\n\n${rows.map(r => `• ${r.product} | ${r.city} | ${r.qty.toLocaleString()} cartons`).join("\n")}`;
      }

      case "get_lots": {
        const where: any = {};
        if (args.lot_number) where.lotNumber = { contains: args.lot_number };
        if (args.status)     where.status = args.status;
        const lots = await prisma.lot.findMany({
          where, orderBy: { createdAt: "desc" }, take: 20,
          include: {
            lotProducts:  { include: { product: { select: { name: true } } } },
            lotPurchases: { select: { totalPriceUsd: true } },
            lotCosts:     { select: { amount: true, currencyCode: true } },
          },
        });
        if (!lots.length) return "No lots found.";
        const lines = lots.map(l => {
          const totalCost  = l.lotPurchases.reduce((s: number, p: any) => s + Number(p.totalPriceUsd), 0);
          const extraCosts = l.lotCosts.reduce((s: number, c: any) => s + Number(c.amount), 0);
          const products   = l.lotProducts.map((p: any) => `${p.product.name} (${Number(p.totalQty)} ctns)`).join(", ");
          return `• Lot ${l.lotNumber} | ${l.status} | Purchase: $${totalCost.toLocaleString()} | Extra: $${extraCosts.toLocaleString()} | ${products}`;
        });
        return `${lots.length} lot(s).\n\n${lines.join("\n")}`;
      }

      case "get_financial_summary": {
        const now = new Date();
        const fromDate = args.from_date ? new Date(args.from_date) : new Date(now.getFullYear(), now.getMonth(), 1);
        const toDate   = args.to_date   ? new Date(args.to_date + "T23:59:59") : new Date();
        let cityId: number | undefined;
        if (args.city_name) {
          const city = await prisma.city.findFirst({ where: { name: { contains: args.city_name, mode: "insensitive" } } });
          if (city) cityId = city.id;
        }
        const cw = cityId ? { cityId } : {};
        const [sales, payments, expenses, hajiTransfers, withdrawals] = await Promise.all([
          prisma.sale.aggregate({ where: { ...cw, status: "active", saleDate: { gte: fromDate, lte: toDate } }, _sum: { totalAmount: true }, _count: true }),
          prisma.payment.aggregate({ where: { ...cw, status: "active", paymentDate: { gte: fromDate, lte: toDate } }, _sum: { amount: true }, _count: true }),
          prisma.expense.aggregate({ where: { ...cw, deletedAt: null, expenseDate: { gte: fromDate, lte: toDate } }, _sum: { amount: true }, _count: true }),
          prisma.hajiTransfer.aggregate({ where: { ...cw, transferDate: { gte: fromDate, lte: toDate } }, _sum: { amount: true }, _count: true }),
          prisma.personalWithdrawal.aggregate({ where: { withdrawalDate: { gte: fromDate, lte: toDate } }, _sum: { amount: true }, _count: true }),
        ]);
        const label  = args.city_name ? ` for ${args.city_name}` : " (all cities)";
        const period = `${fromDate.toISOString().split("T")[0]} to ${toDate.toISOString().split("T")[0]}`;
        return `Financial Summary${label} | ${period}\n\nSales: $${Number(sales._sum.totalAmount || 0).toLocaleString()} (${sales._count} txns)\nPayments Received: $${Number(payments._sum.amount || 0).toLocaleString()} (${payments._count})\nExpenses: $${Number(expenses._sum.amount || 0).toLocaleString()} (${expenses._count})\nHaji Transfers: $${Number(hajiTransfers._sum.amount || 0).toLocaleString()} (${hajiTransfers._count})\nWithdrawals: $${Number(withdrawals._sum.amount || 0).toLocaleString()} (${withdrawals._count})`;
      }

      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err: any) {
    console.error(`Tool ${name} error:`, err?.message);
    return `Error in ${name}: ${err.message}`;
  }
}

// ─── Route Handler ──────────────────────────────────────────────────────────
export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  if (user.role !== "super_admin") {
    return NextResponse.json({ error: "Superadmin only" }, { status: 403 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY is not configured on the server." }, { status: 500 });
  }

  try {
    const { messages: clientHistory, message } = await request.json();

    const SYSTEM = `You are a smart business assistant for MRF Hardware Management System. You help the superadmin answer questions about their business data.

You have access to tools that query the live database. Always use tools before answering. Never make up numbers.

The system covers: Sales, Payments, Expenses, Haji Transfers, Personal Withdrawals, Inventory, Suppliers, Lots, Customers.

When answering: use bullet points, always show totals and counts, be concise.
Amounts are USD unless stated. "5 lacs" = 500,000 | "1 crore" = 10,000,000

Today's date: ${new Date().toISOString().split("T")[0]}`;

    // Build message history in OpenAI format
    const messages: object[] = [
      { role: "system", content: SYSTEM },
      ...(clientHistory || []).map((m: any) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: m.content || "",
      })),
      { role: "user", content: message },
    ];

    // Agentic loop — up to 5 rounds of tool calls
    let iterations = 0;
    while (iterations < 5) {
      const data = await callDeepSeek(apiKey, messages, TOOLS);
      const choice = data.choices?.[0];
      if (!choice) throw new Error("No response from DeepSeek");

      const msg = choice.message;
      messages.push(msg); // add assistant message to history

      // No tool calls → return the final text
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return NextResponse.json({ reply: msg.content || "" });
      }

      // Execute all tool calls in parallel
      const toolResults = await Promise.all(
        msg.tool_calls.map(async (tc: any) => {
          const args = typeof tc.function.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments;
          const result = await executeTool(tc.function.name, args);
          return {
            role: "tool",
            tool_call_id: tc.id,
            content: result,
          };
        })
      );

      messages.push(...toolResults);
      iterations++;
    }

    return NextResponse.json({ reply: "I wasn't able to complete the request. Please try rephrasing." });

  } catch (err: any) {
    console.error("Assistant error:", err?.message);
    return NextResponse.json({ error: err.message || "Failed" }, { status: 500 });
  }
});
