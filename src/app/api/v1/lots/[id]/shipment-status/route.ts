import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { LOT_SHIPMENT_STATUS_VALUES, lotShipmentStatusLabel } from "@/lib/lot-documents";

function formatHistory(row: any) {
  return {
    id: row.id,
    previousStatus: row.previousStatus,
    previousStatusLabel: lotShipmentStatusLabel(row.previousStatus),
    newStatus: row.newStatus,
    newStatusLabel: lotShipmentStatusLabel(row.newStatus),
    effectiveAt: row.effectiveAt.toISOString(),
    location: row.location,
    note: row.note,
    changedBy: row.changer ? { id: row.changer.id, fullName: row.changer.fullName } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const GET = withSuperAdmin(async (_request: NextRequest, context: any) => {
  try {
    const lotId = Number(context.params.id);
    if (!lotId) return validationError("Invalid lot");
    const lot = await prisma.lot.findUnique({
      where: { id: lotId },
      select: { id: true, shipmentStatus: true, etaDate: true },
    });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);
    const history = await prisma.lotStatusHistory.findMany({
      where: { lotId },
      include: { changer: { select: { id: true, fullName: true } } },
      orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
    });
    return successResponse({
      shipmentStatus: lot.shipmentStatus,
      shipmentStatusLabel: lotShipmentStatusLabel(lot.shipmentStatus),
      etaDate: lot.etaDate ? lot.etaDate.toISOString().split("T")[0] : null,
      history: history.map(formatHistory),
    });
  } catch (error) {
    console.error("Lot shipment history error:", error);
    return serverError();
  }
});

export const PUT = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const lotId = Number(context.params.id);
    if (!lotId) return validationError("Invalid lot");
    const body = await request.json();
    const nextStatus = String(body.shipmentStatus || "");
    if (!LOT_SHIPMENT_STATUS_VALUES.includes(nextStatus as any)) return validationError("Invalid shipment status");

    const lot = await prisma.lot.findUnique({ where: { id: lotId }, select: { id: true, shipmentStatus: true, lotNumber: true } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    const effectiveAtRaw = String(body.effectiveAt || "").trim();
    const effectiveAt = effectiveAtRaw ? new Date(effectiveAtRaw) : new Date();
    if (Number.isNaN(effectiveAt.getTime())) return validationError("Invalid effective date");
    const etaDateRaw = String(body.etaDate || "").trim();
    const etaDate = etaDateRaw ? new Date(`${etaDateRaw}T00:00:00.000Z`) : null;
    if (etaDateRaw && Number.isNaN(etaDate!.getTime())) return validationError("Invalid ETA");
    const location = String(body.location || "").trim() || null;
    const note = String(body.note || "").trim() || null;

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.lot.update({
        where: { id: lotId },
        data: { shipmentStatus: nextStatus as any, etaDate },
        select: { id: true, shipmentStatus: true, etaDate: true },
      });
      const history = await tx.lotStatusHistory.create({
        data: {
          lotId,
          previousStatus: lot.shipmentStatus,
          newStatus: nextStatus as any,
          effectiveAt,
          location,
          note,
          changedBy: user.userId,
        },
        include: { changer: { select: { id: true, fullName: true } } },
      });
      await createAuditLog(user.userId, null, "lot_status_history", history.id, "create", {
        shipmentStatus: lot.shipmentStatus,
      }, {
        shipmentStatus: nextStatus,
        location,
        note,
      }, getClientIP(request), tx);
      return { updated, history };
    });

    return successResponse({
      shipmentStatus: result.updated.shipmentStatus,
      shipmentStatusLabel: lotShipmentStatusLabel(result.updated.shipmentStatus),
      etaDate: result.updated.etaDate ? result.updated.etaDate.toISOString().split("T")[0] : null,
      history: formatHistory(result.history),
    }, "Shipment status updated");
  } catch (error) {
    console.error("Update lot shipment status error:", error);
    return serverError();
  }
});
