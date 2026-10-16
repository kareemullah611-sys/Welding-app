type ReadResult = { success: boolean; data?: unknown; pagination?: unknown; error?: string };
type Reader = (url: string, options: { params: Record<string, string | number> }) => Promise<ReadResult>;

export async function fetchInHandPaymentCheques(read: Reader): Promise<{ success: boolean; data?: unknown[]; error?: string }> {
  const rows: unknown[] = [];
  const ids = new Set<number>();
  let total: number | undefined;
  for (let page = 1; ; page++) {
    const result = await read("/api/v1/payments", { params: {
      page, limit: 100, status: "active", payment_method: "cheque",
      destination: "our_account", cheque_status: "in_hand",
    } });
    if (!result.success) return { success: false, error: result.error || "Unable to load in-hand cheques. Reopen the form to retry." };
    const pagination = result.pagination as { page: number; total: number; totalPages: number } | undefined;
    if (!Array.isArray(result.data) || !pagination || pagination.page !== page ||
        !Number.isInteger(pagination.total) || pagination.total < 0 ||
        !Number.isInteger(pagination.totalPages) || pagination.totalPages < 0 ||
        (total !== undefined && total !== pagination.total)) {
      return { success: false, error: "Cheque list is incomplete or changed. Reopen the form to retry." };
    }
    total = pagination.total;
    for (const row of result.data) {
      if (ids.has(row.id)) return { success: false, error: "Cheque list changed while loading. Reopen the form to retry." };
      ids.add(row.id);
      rows.push(row);
    }
    if (page >= pagination.totalPages) {
      return rows.length === total
        ? { success: true, data: rows }
        : { success: false, error: "Cheque list is incomplete. Reopen the form to retry." };
    }
    if (result.data.length === 0) return { success: false, error: "Cheque list is incomplete. Reopen the form to retry." };
  }
}
