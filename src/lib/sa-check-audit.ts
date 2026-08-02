import prisma from "@/lib/prisma";

export type SaCheckEntityType = "payments" | "haji_transfers" | "expenses" | "personal_withdrawals";

export function saCheckAuditStateMapFromLogs(logs: any[]) {
  const stateByEntityId: Record<number, any> = {};
  for (const log of logs) {
    if (stateByEntityId[log.entityId]) continue;
    const values = (log.newValues || {}) as Record<string, any>;
    if (typeof values.saCheckConfirmed !== "boolean") continue;

    stateByEntityId[log.entityId] = {
      confirmed: values.saCheckConfirmed,
      confirmedAt: log.createdAt.toISOString(),
      confirmedBy: log.user
        ? {
            id: log.user.id,
            fullName: log.user.fullName,
            username: log.user.username,
          }
        : null,
      note: typeof values.saCheckNote === "string" ? values.saCheckNote : null,
    };
  }

  return stateByEntityId;
}

export async function getSaCheckAuditStateMap(entityType: SaCheckEntityType, entityIds: number[]) {
  const ids = Array.from(new Set(entityIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return {} as Record<number, any>;

  const logs = await prisma.auditLog.findMany({
    where: {
      entityType,
      entityId: { in: ids },
      action: "update",
    },
    include: {
      user: { select: { id: true, fullName: true, username: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return saCheckAuditStateMapFromLogs(logs);
}

export async function isSaCheckConfirmed(entityType: SaCheckEntityType, entityId: number): Promise<boolean> {
  const stateById = await getSaCheckAuditStateMap(entityType, [entityId]);
  return !!stateById[entityId]?.confirmed;
}
