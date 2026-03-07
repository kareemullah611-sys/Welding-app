// ============================================================
// Shared Types for Welding Materials Management System
// ============================================================

// User & Auth
export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: "super_admin" | "city_admin";
  cityId: number | null;
  cityName: string | null;
  countryId: number | null;
  countryName: string | null;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

// Countries & Cities
export interface Country {
  id: number;
  name: string;
  code: string;
  citiesCount?: number;
}

export interface City {
  id: number;
  countryId: number;
  name: string;
  isActive: boolean;
  country?: Country;
  currencies?: CurrencyInfo[];
}

export interface CurrencyInfo {
  id: number;
  code: string;
  name: string;
  symbol: string;
}

// Products
export interface Product {
  id: number;
  name: string;
  isActive: boolean;
}

// Godowns
export interface Godown {
  id: number;
  cityId: number;
  name: string;
  isActive: boolean;
  city?: City;
}

export interface GodownTransferRecord {
  id: number;
  fromGodown: Godown;
  toGodown: Godown;
  product: Product;
  lot: LotBasic;
  qty: number;
  transferDate: string;
  notes?: string;
  creator: { id: number; fullName: string };
}

// Customers
export interface Customer {
  id: number;
  cityId: number;
  name: string;
  phone?: string;
  address?: string;
  isActive: boolean;
  city?: City;
}

export interface CustomerBalance {
  currencyCode: string;
  currencySymbol: string;
  totalSales: number;
  totalPayments: number;
  totalDiscounts: number;
  balance: number;
  status: "customer_owes" | "we_owe" | "settled";
}

export interface CustomerLedgerEntry {
  type: "sale" | "payment" | "discount";
  date: string;
  voucherNo: string;
  detail: string;
  debit: number;
  credit: number;
  balance: number;
  currency: string;
  status: string;
  id: number;
}

// Lots
export interface LotBasic {
  id: number;
  lotNumber: string;
  countryId: number;
  status: "ongoing" | "completed";
}

export interface Lot extends LotBasic {
  lotDate: string;
  notes?: string;
  country: Country;
  products: LotProductItem[];
  distributions?: LotDistribution[];
  createdBy: { id: number; fullName: string };
  completedBy?: { id: number; fullName: string };
  completedAt?: string;
  createdAt: string;
}

export interface LotProductItem {
  id: number;
  productId: number;
  productName: string;
  totalQty: number;
  distributedQty: number;
}

export interface LotDistribution {
  id: number;
  cityId: number;
  cityName: string;
  productId: number;
  productName: string;
  allocatedQty: number;
}

export interface LotSettlement {
  cityId: number;
  cityName: string;
  currency: string;
  grossRevenue: number;
  totalExpenses: number;
  totalDiscounts: number;
  netAmount: number;
  transferredToHaji: number;
  remainingOwed: number;
  overflowAmount?: number;
  overflowToLotId?: number;
  overflowToLotNumber?: string;
}

// Sales
export interface Sale {
  id: number;
  cityId: number;
  customerId: number;
  lotId: number;
  godownId: number;
  voucherNo: string;
  saleDate: string;
  totalAmount: number;
  currencyId: number;
  notes?: string;
  status: "active" | "cancelled" | "marked_short";
  stockShortFlag: boolean;
  cancellationReason?: string;
  customer: Customer;
  lot: LotBasic;
  godown: Godown;
  currency: CurrencyInfo;
  items: SaleItemDetail[];
  createdBy: { id: number; fullName: string };
}

export interface SaleItemDetail {
  id: number;
  productId: number;
  productName: string;
  qty: number;
  ratePerCarton: number;
  amount: number;
}

// Payments
export interface PaymentRecord {
  id: number;
  cityId: number;
  customerId: number;
  lotId: number;
  paymentDate: string;
  detail: string;
  amount: number;
  currencyId: number;
  manualVoucherNo?: string;
  paymentMethod: "cash" | "cheque" | "bank_transfer" | "online";
  destination: "haji" | "our_account";
  notes?: string;
  status: "active" | "cancelled";
  cancellationReason?: string;
  customer: Customer;
  lot: LotBasic;
  currency: CurrencyInfo;
  createdBy: { id: number; fullName: string };
}

// Expenses
export interface ExpenseRecord {
  id: number;
  cityId: number;
  lotId: number;
  expenseDate: string;
  amount: number;
  detail: string;
  notes?: string;
  currency: CurrencyInfo;
  lot: LotBasic;
  createdBy: { id: number; fullName: string };
}

// Personal Withdrawals
export interface WithdrawalRecord {
  id: number;
  cityId: number;
  withdrawalDate: string;
  amount: number;
  detail: string;
  notes?: string;
  currency: CurrencyInfo;
  createdBy: { id: number; fullName: string };
}

// Haji Transfers
export interface HajiTransferRecord {
  id: number;
  cityId: number;
  lotId: number;
  transferDate: string;
  amount: number;
  detail: string;
  transferType: "direct" | "from_in_hand";
  notes?: string;
  currency: CurrencyInfo;
  lot: LotBasic;
  createdBy: { id: number; fullName: string };
}

// Inventory
export interface InventoryView {
  grandTotalQty: number;
  productsSummary: { productId: number; productName: string; totalQty: number }[];
  godownsSummary: { godownId: number; godownName: string; totalQty: number }[];
  detailed: {
    godownId: number;
    godownName: string;
    products: { productId: number; productName: string; qty: number }[];
  }[];
}

// Dashboard
export interface DashboardData {
  totalOutstanding: { currency: string; amount: number }[];
  totalOwedToHaji: { currency: string; amount: number }[];
  totalCartonsSold: number;
  totalPersonalWithdrawals: { currency: string; amount: number }[];
  ongoingLots?: LotBasic[];
  notifications: NotificationItem[];
}

export interface SuperAdminDashboard extends DashboardData {
  citiesOverview: {
    cityId: number;
    cityName: string;
    country: string;
    outstanding: number;
    owedToHaji: number;
    cartonsSold: number;
    personalWithdrawals: number;
    currency: string;
    activeLots: number;
    lowStockAlerts: number;
  }[];
}

// Notifications
export interface NotificationItem {
  id: number;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

// Audit Logs
export interface AuditLogEntry {
  id: number;
  user: { id: number; fullName: string };
  city?: { id: number; name: string };
  entityType: string;
  entityId: number;
  action: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: string;
}

// Attachments
export interface AttachmentInfo {
  id: number;
  entityType: string;
  entityId: number;
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  uploadedBy: { id: number; fullName: string };
  createdAt: string;
}

// API Response types
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  message: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown[];
  };
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

// Form types for frontend
export interface SaleFormData {
  customerId: number;
  godownId: number;
  lotId?: number | null;
  saleDate: string;
  currencyId: number;
  notes?: string;
  items: {
    productId: number;
    qty: number;
    ratePerCarton: number;
  }[];
}

export interface PaymentFormData {
  customerId: number;
  lotId?: number | null;
  paymentDate: string;
  detail: string;
  amount: number;
  currencyId: number;
  manualVoucherNo?: string;
  paymentMethod: "cash" | "cheque" | "bank_transfer" | "online";
  destination: "haji" | "our_account";
  notes?: string;
}
