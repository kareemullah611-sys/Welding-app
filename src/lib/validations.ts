import { z } from "zod";

// ============================================================
// AUTH
// ============================================================
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  // Intentionally permissive at login — we do not want to reject valid existing passwords
  password: z.string().min(1, "Password is required"),
});

/** Reusable strong-password rule enforced on create/change operations. */
const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: strongPassword,
});

// ============================================================
// USERS
// ============================================================
export const createUserSchema = z.object({
  username: z.string().min(3).max(100),
  password: strongPassword,
  fullName: z.string().min(1).max(200),
  role: z.enum(["super_admin", "city_admin"]),
  cityId: z.number().int().positive().optional().nullable(),
}).refine(
  (data) => {
    if (data.role === "city_admin" && !data.cityId) return false;
    if (data.role === "super_admin" && data.cityId) return false;
    return true;
  },
  { message: "City admin requires cityId; Super admin must not have cityId" }
);


// ============================================================
// CITIES
// ============================================================
export const createCitySchema = z.object({
  countryId: z.number().int().positive(),
  name: z.string().min(1).max(200),
  currencyIds: z.array(z.number().int().positive()).min(1),
});


// ============================================================
// PRODUCTS
// ============================================================
export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
});


// ============================================================
// GODOWNS
// ============================================================
export const createGodownSchema = z.object({
  cityId: z.number().int().positive(),
  name: z.string().min(1).max(200),
});


// ============================================================
// CUSTOMERS
// ============================================================
export const createCustomerSchema = z.object({
  cityId: z.number().int().optional().nullable(),
  name: z.string().min(1).max(200),
  phone: z.string().max(50).optional(),
  address: z.string().optional(),
});

export const updateCustomerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(50).optional().nullable(),
  address: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// ============================================================
// LOTS
// ============================================================
const lotProductSchema = z.object({
  productId: z.number().int().positive(),
  totalQty: z.number().positive(),
});

const lotDistributionSchema = z.object({
  cityId: z.number().int().positive(),
  productId: z.number().int().positive(),
  allocatedQty: z.number().min(0),
});

// Purchase item on the invoice-style lot creation form
const lotPurchaseItemSchema = z.object({
  supplierId:        z.number().int().positive(),
  productId:         z.number().int().positive(),
  weightPerCartonKg: z.number().positive(),  // kg per carton e.g. 20
  qtyMt:             z.number().positive(),  // quantity in metric tons
  unitPriceUsdPerMt: z.number().positive(),  // USD per MT
});

export const createLotSchema = z.object({
  countryId:     z.number().int().positive(),
  lotNumber:     z.string().min(1).max(50),
  lotDate:       z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes:         z.string().optional(),
  purchaseItems: z.array(lotPurchaseItemSchema).min(1),
  distributions: z.array(lotDistributionSchema).optional(),
});


// ============================================================
// SALES
// ============================================================
const saleItemSchema = z.object({
  productId: z.number().int().positive(),
  qty: z.number().positive(),
  ratePerCarton: z.number().min(0),
});

export const createSaleSchema = z.object({
  customerId: z.number().int().refine((v) => v === -1 || v > 0, "Invalid customer"),
  godownId: z.number().int().positive(),
  lotId: z.number().int().optional().nullable(),
  saleDate: z.string(),
  currencyId: z.number().int().optional().nullable(),
  notes: z.string().optional(),
  items: z.array(saleItemSchema).min(1),
});


// ============================================================
// PAYMENTS
// ============================================================
export const createPaymentSchema = z.object({
  customerId: z.number().int().refine((v) => v === -1 || v > 0, "Invalid customer"),
  lotId: z.number().int().optional().nullable(),
  paymentDate: z.string(),
  detail: z.string().min(1).max(500),
  amount: z.number().positive(),
  currencyId: z.number().int().optional().nullable(),
  exchangeRate: z.number().positive().optional().nullable(),  // AFN/USD rate on payment day
  usdEquivalent: z.number().positive().optional().nullable(), // USD value of AFN payment
  manualVoucherNo: z.string().max(50).optional(),
  paymentMethod: z.enum(["cash", "cheque", "bank_transfer", "online"]),
  destination: z.enum(["haji", "our_account"]),
  notes: z.string().optional(),
});


// ============================================================
// EXPENSES
// ============================================================
export const createExpenseSchema = z.object({
  lotId: z.number().int().optional().nullable(),
  expenseDate: z.string(),
  amount: z.number().positive(),
  currencyId: z.number().int().optional().nullable(),
  detail: z.string().min(1).max(500),
  notes: z.string().optional(),
});


// ============================================================
// PERSONAL WITHDRAWALS
// ============================================================
export const createWithdrawalSchema = z.object({
  withdrawalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().positive(),
  currencyId: z.number().int().positive(),
  detail: z.string().min(1).max(500),
  withdrawnBy: z.string().max(100).optional(),
  notes: z.string().optional(),
});


// ============================================================
// HAJI TRANSFERS
// ============================================================
export const createHajiTransferSchema = z.object({
  lotId: z.number().int().optional().nullable(),
  transferDate: z.string(),
  amount: z.number().positive(),
  currencyId: z.number().int().optional().nullable(),
  detail: z.string().min(1).max(500),
  transferType: z.enum(["direct", "from_in_hand"]),
  transferredTo: z.string().max(100).optional().nullable(),
  notes: z.string().optional(),
});


// ============================================================
// INVENTORY THRESHOLDS
// ============================================================

// ============================================================
// SUPPLIER
// ============================================================
export const createSupplierSchema = z.object({
  name: z.string().min(1).max(200),
  country: z.string().max(100).optional(),
  contact: z.string().max(200).optional(),
  notes: z.string().optional(),
});

// ============================================================
// LOT PURCHASE (purchase price per product)
// ============================================================
export const createLotPurchaseSchema = z.object({
  lotId: z.number().int().positive(),
  supplierId: z.number().int().positive(),
  products: z.array(z.object({
    productId: z.number().int().positive(),
    qty: z.number().positive(),
    unitPriceUsd: z.number().positive(),
  })).min(1),
  exchangeRate: z.number().positive().optional(),
});

// ============================================================
// LOT COST (customs, freight, transport, etc.)
// ============================================================
export const createLotCostSchema = z.object({
  lotId: z.number().int().positive(),
  costType: z.enum([
    "purchase_price",
    "freight",
    "customs_duty",
    "customs_agent",
    "clearing_agent",
    "port_charges",
    "transport",
    "loading_unloading",
    "insurance",
    "other",
  ]),
  description: z.string().min(1).max(500),
  amount: z.number().positive(),
  currencyCode: z.string().max(10).default("USD"),
  exchangeRate: z.number().positive().optional(),
  costDate: z.string().optional(),
  supplierId: z.number().int().positive().optional().nullable(),
  agentId: z.number().int().optional().nullable(),
  shippingLineId: z.number().int().optional().nullable(),
  bankAccountId: z.number().int().positive().optional().nullable(),
  superAdminBankAccountId: z.number().int().positive().optional().nullable(),
  intermediaryId: z.number().int().positive().optional().nullable(),
  paidFromCash: z.boolean().optional(),
  notes: z.string().optional(),
});

// ============================================================
// SUPPLIER PAYMENT
// ============================================================
export const createSupplierPaymentSchema = z.object({
  supplierId: z.number().int().positive(),
  lotId: z.number().int().positive().optional(),
  paymentDate: z.string(),
  amountUsd: z.number().positive(),
  exchangeRate: z.number().positive().optional(),
  amountLocal: z.number().positive().optional(),
  paymentMethod: z.enum(["bank_transfer", "tt", "lc", "cash", "other"]),
  reference: z.string().max(200).optional(),
  notes: z.string().optional(),
  bankAccountId: z.number().int().positive().optional(),
  intermediaryId: z.number().int().positive().optional(),
});
