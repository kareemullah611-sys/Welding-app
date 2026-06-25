import prisma from "@/lib/prisma";

export function isAfghanistanHajiSettlementEligible(transferLike: {
  settlementDestination?: string | null;
  sourceType?: string | null;
}) {
  return (
    transferLike.sourceType === "cash_office" &&
    (transferLike.settlementDestination === "intermediary" ||
      transferLike.settlementDestination === "super_admin_cash")
  );
}

export async function getHajiTransferAuditStateMap(transferIds: number[]) {
  const ids = Array.from(new Set(transferIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (ids.length === 0) return {} as Record<number, any>;

  try {
    const logs = await prisma.auditLog.findMany({
      where: {
        entityType: "haji_transfers",
        entityId: { in: ids },
        action: "update",
      },
      include: {
        user: { select: { id: true, fullName: true, username: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const stateByTransferId: Record<number, any> = {};
    for (const log of logs) {
      if (stateByTransferId[log.entityId]) continue;
      const values = (log.newValues || {}) as Record<string, any>;
      if (typeof values.hajiAuditConfirmed !== "boolean") continue;

      stateByTransferId[log.entityId] = {
        confirmed: values.hajiAuditConfirmed,
        confirmedAt: log.createdAt.toISOString(),
        confirmedBy: log.user
          ? {
              id: log.user.id,
              fullName: log.user.fullName,
              username: log.user.username,
            }
          : null,
        note: typeof values.hajiAuditNote === "string" ? values.hajiAuditNote : null,
      };
    }

    return stateByTransferId;
  } catch (error) {
    console.error("Haji transfer audit lookup failed:", error);
    return {} as Record<number, any>;
  }
}

export async function isHajiTransferAuditConfirmed(transferId: number): Promise<boolean> {
  const map = await getHajiTransferAuditStateMap([transferId]);
  return !!map[transferId]?.confirmed;
}
