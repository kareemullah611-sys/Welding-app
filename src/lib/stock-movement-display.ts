import { formatDisplayDate } from "@/lib/display-date";

export function formatInventoryDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const formatted = formatDisplayDate(value);
  return formatted === "-" ? "—" : formatted;
}

export type StockMovementTypeTone = "in" | "out" | "alloc" | "sale" | "transfer" | "default";

export function formatStockMovementType(type: string): { label: string; tone: StockMovementTypeTone } {
  switch (type) {
    case "godown_in":
      return { label: "In", tone: "in" };
    case "godown_out":
      return { label: "Out", tone: "out" };
    case "city_in":
      return { label: "Transfer In", tone: "transfer" };
    case "city_out":
      return { label: "Transfer Out", tone: "transfer" };
    case "allocation":
      return { label: "Allocation", tone: "alloc" };
    case "sale":
      return { label: "Sale", tone: "sale" };
    default:
      return {
        label: String(type || "—")
          .replace(/_/g, " ")
          .replace(/\b\w/g, (char) => char.toUpperCase()),
        tone: "default",
      };
  }
}

export const stockMovementTypeClass: Record<StockMovementTypeTone, string> = {
  in: "bg-emerald-50 text-emerald-700 border-emerald-100",
  out: "bg-red-50 text-red-700 border-red-100",
  alloc: "bg-blue-50 text-blue-700 border-blue-100",
  sale: "bg-violet-50 text-violet-700 border-violet-100",
  transfer: "bg-amber-50 text-amber-800 border-amber-100",
  default: "bg-gray-100 text-gray-700 border-gray-200",
};
