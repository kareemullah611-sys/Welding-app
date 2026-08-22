export const LOT_SHIPMENT_STATUSES = [
  { value: "order_confirmed", label: "Order Confirmed" },
  { value: "production", label: "Production" },
  { value: "at_tianjin_port", label: "At Tianjin Port" },
  { value: "awaiting_departure", label: "Awaiting Departure" },
  { value: "departed_tianjin", label: "Departed Tianjin" },
  { value: "tianjin_to_karachi", label: "Tianjin → Karachi" },
  { value: "arrived_karachi", label: "Arrived Karachi" },
  { value: "customs_clearance", label: "Customs Clearance" },
  { value: "customs_cleared", label: "Customs Cleared" },
  { value: "karachi_to_lahore", label: "Karachi → destination city" },
  { value: "arrived_warehouse", label: "Arrived Warehouse" },
  { value: "completed", label: "Completed" },
  { value: "delayed", label: "Delayed" },
  { value: "on_hold", label: "On Hold" },
  { value: "documents_pending", label: "Documents Pending" },
  { value: "customs_hold", label: "Customs Hold" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export const LOT_DOCUMENT_CATEGORIES = [
  { value: "supplier_invoice", label: "Supplier Invoice" },
  { value: "packing_list", label: "Packing List" },
  { value: "bill_of_lading", label: "Bill of Lading" },
  { value: "gd_customs", label: "GD / Customs" },
  { value: "freight_shipping", label: "Freight / Shipping" },
  { value: "payment_proof", label: "Payment Proof" },
  { value: "other", label: "Other" },
] as const;

export type LotShipmentStatusCode = (typeof LOT_SHIPMENT_STATUSES)[number]["value"];
export type LotDocumentCategoryCode = (typeof LOT_DOCUMENT_CATEGORIES)[number]["value"];

export const LOT_SHIPMENT_STATUS_VALUES = LOT_SHIPMENT_STATUSES.map((row) => row.value);
export const LOT_DOCUMENT_CATEGORY_VALUES = LOT_DOCUMENT_CATEGORIES.map((row) => row.value);

export function lotShipmentStatusLabel(value?: string | null) {
  return LOT_SHIPMENT_STATUSES.find((row) => row.value === value)?.label || "Order Confirmed";
}

export function lotDocumentCategoryLabel(value?: string | null) {
  return LOT_DOCUMENT_CATEGORIES.find((row) => row.value === value)?.label || "Other";
}

export const LOT_DOCUMENT_MAX_SIZE_BYTES = 15 * 1024 * 1024;

const ALLOWED_LOT_DOCUMENTS: Record<string, { extension: string; mimeTypes: string[] }> = {
  pdf: { extension: "pdf", mimeTypes: ["application/pdf"] },
  xlsx: {
    extension: "xlsx",
    mimeTypes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  xls: {
    extension: "xls",
    mimeTypes: ["application/vnd.ms-excel", "application/octet-stream"],
  },
  csv: { extension: "csv", mimeTypes: ["text/csv", "application/csv", "application/vnd.ms-excel"] },
  jpg: { extension: "jpg", mimeTypes: ["image/jpeg", "image/jpg"] },
  jpeg: { extension: "jpg", mimeTypes: ["image/jpeg", "image/jpg"] },
  png: { extension: "png", mimeTypes: ["image/png"] },
  numbers: {
    extension: "numbers",
    mimeTypes: ["application/vnd.apple.numbers", "application/zip", "application/octet-stream", ""],
  },
};

export function validateLotDocumentFile(file: File | { name: string; type?: string; size: number }) {
  const name = String(file.name || "").trim();
  if (!name) return { ok: false as const, message: "Filename is required" };
  if (name.includes("/") || name.includes("\\")) return { ok: false as const, message: "Filename cannot include path separators" };
  if (file.size <= 0) return { ok: false as const, message: "File is empty" };
  if (file.size > LOT_DOCUMENT_MAX_SIZE_BYTES) return { ok: false as const, message: "File must be under 15MB" };

  const rawExtension = name.split(".").pop()?.toLowerCase() || "";
  const config = ALLOWED_LOT_DOCUMENTS[rawExtension];
  if (!config) return { ok: false as const, message: "Only PDF, XLSX, XLS, CSV, JPG, PNG, and Numbers files are allowed" };

  const mimeType = String(file.type || "");
  if (config.mimeTypes.length && !config.mimeTypes.includes(mimeType)) {
    return { ok: false as const, message: "File type does not match the allowed document format" };
  }

  return { ok: true as const, extension: config.extension, mimeType };
}
