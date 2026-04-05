import prisma from "@/lib/prisma";

export const HAJI_AUDIT_ELIGIBLE_METHODS = ["cash", "bank_transfer", "online"] as const;

export function isHajiAuditEligible(paymentLike: { destination?: string | null; paymentMethod?: string | null }) {
  return paymentLike.destination === "haji" && HAJI_AUDIT_ELIGIBLE_METHODS.includes((paymentLike.paymentMethod || "") as any);
}

export async function getPaymentHajiAuditStateMap(paymentIds: number[]) {
  const ids = Array.from(new Set(paymentIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return {} as Record<number, any>;

  const logs = await prisma.auditLog.findMany({
    where: {
      entityType: "payments",
      entityId: { in: ids },
      action: "update",
    },
    include: {
      user: { select: { id: true, fullName: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const stateByPaymentId: Record<number, any> = {};
  for (const log of logs) {
    if (stateByPaymentId[log.entityId]) continue;
    const values = (log.newValues || {}) as Record<string, any>;
    if (typeof values.hajiAuditConfirmed !== "boolean") continue;

    stateByPaymentId[log.entityId] = {
      confirmed: values.hajiAuditConfirmed,
      confirmedAt: log.createdAt.toISOString(),
      confirmedBy: log.user ? {
        id: log.user.id,
        fullName: log.user.fullName,
        username: log.user.username,
      } : null,
      note: typeof values.hajiAuditNote === "string" ? values.hajiAuditNote : null,
    };
  }

  return stateByPaymentId;
}
