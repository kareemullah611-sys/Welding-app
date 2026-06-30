/** Display date as dd-mm-yy on module pages and ledgers. */
export function formatDisplayDate(dateStr: string | Date | null | undefined): string {
  if (dateStr == null || dateStr === "") return "-";
  if (typeof dateStr === "string") {
    const iso = dateStr.split("T")[0];
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (match) return `${match[3]}-${match[2]}-${match[1].slice(-2)}`;
  }
  const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(-2);
  return `${dd}-${mm}-${yy}`;
}
