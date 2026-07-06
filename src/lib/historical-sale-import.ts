import prisma from "@/lib/prisma";
import { Prisma, PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

function roundMoney(n: number) {
  return Math.round(n * 100) / 100;
}

export async function generateOpeningVoucherNo(cityId: number, db: DbClient = prisma): Promise<string> {
  const latest = await db.sale.findFirst({
    where: { cityId, voucherNo: { startsWith: "O-" } },
    orderBy: { voucherNo: "desc" },
    select: { voucherNo: true },
  });
  const lastNum = latest ? parseInt(String(latest.voucherNo).replace(/^O-/, ""), 10) : 0;
  const next = Number.isFinite(lastNum) ? lastNum + 1 : 1;
  return `O-${String(next).padStart(4, "0")}`;
}

export type HistoricalSaleInput = {
  cityId: number;
  customerId: number;
  lotId: number;
  godownId: number;
  productId: number;
  qty: number;
  amount: number;
  currencyId: number;
  saleDate: Date;
  notes?: string | null;
  /** When true, sale counts for stock/Haji on lot but not customer receivable. */
  skipCustomerLedger?: boolean;
  createdBy: number;
};

export async function createHistoricalSale(input: HistoricalSaleInput, db: DbClient = prisma) {
  const lot = await db.lot.findFirst({
    where: { id: input.lotId, status: "ongoing" },
    include: { lotCityDistributions: { where: { cityId: input.cityId } } },
  });
  if (!lot) throw new Error("Sale lot must be an ongoing lot");
  if (!lot.lotCityDistributions.length) {
    throw new Error("Lot is not distributed to this city");
  }

  const godown = await db.godown.findFirst({
    where: { id: input.godownId, cityId: input.cityId, isActive: true },
  });
  if (!godown) throw new Error("Godown not found in city");

  const customer = await db.customer.findFirst({
    where: { id: input.customerId, cityId: input.cityId, isActive: true },
  });
  if (!customer) throw new Error("Customer not found in city");

  const qty = Number(input.qty);
  const amount = roundMoney(Number(input.amount));
  if (qty <= 0) throw new Error("Quantity must be greater than 0");
  if (amount < 0) throw new Error("Amount cannot be negative");

  const product = await db.product.findFirst({
    where: { id: input.productId, isActive: true },
    select: { id: true, name: true, unitOfMeasure: true, piecesPerCarton: true },
  });
  if (!product) throw new Error("Product not found");

  const voucherNo = await generateOpeningVoucherNo(input.cityId, db);
  const cartonQty = product.unitOfMeasure === "PCS" ? qty : null;
  if (product.unitOfMeasure === "PCS" && !product.piecesPerCarton) {
    throw new Error(`${product.name}: PCS/CTN is required on product master`);
  }
  const piecesPerCarton = Number(product.piecesPerCarton || 0);
  const stockQty = product.unitOfMeasure === "PCS" ? cartonQty! * piecesPerCarton : qty;
  const ratePerCarton = qty > 0 ? roundMoney(amount / qty) : 0;
  const ratePerPieceLocal = product.unitOfMeasure === "PCS" && stockQty > 0 ? roundMoney(amount / stockQty) : null;

  const sale = await db.sale.create({
    data: {
      cityId: input.cityId,
      customerId: input.customerId,
      lotId: input.lotId,
      godownId: input.godownId,
      voucherNo,
      saleDate: input.saleDate,
      totalAmount: amount,
      currencyId: input.currencyId,
      notes: input.notes || "Pre-go-live historical sale import",
      status: "active",
      isOpeningImport: input.skipCustomerLedger ?? true,
      createdBy: input.createdBy,
      items: {
        create: [{
          productId: input.productId,
          qty: stockQty,
          cartonQty,
          ratePerCarton,
          ratePerPieceLocal,
          amount,
        }],
      },
    },
    include: {
      customer: { select: { name: true } },
      lot: { select: { lotNumber: true } },
    },
  });

  return sale;
}
