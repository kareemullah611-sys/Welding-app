import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin, createAuditLog, getClientIP } from "@/lib/middleware";
import { errorResponse, serverError, successResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { createLotDocumentStorageKey, uploadLotDocumentToBucket } from "@/lib/railway-bucket";
import {
  LOT_DOCUMENT_CATEGORY_VALUES,
  lotDocumentCategoryLabel,
  validateLotDocumentFile,
} from "@/lib/lot-documents";

function formatDocument(row: any) {
  return {
    id: row.id,
    lotId: row.lotId,
    category: row.category,
    categoryLabel: lotDocumentCategoryLabel(row.category),
    originalFileName: row.originalFileName,
    downloadUrl: `/api/v1/lots/${row.lotId}/documents/${row.id}/download`,
    mimeType: row.mimeType,
    extension: row.extension,
    fileSize: row.fileSize,
    referenceNo: row.referenceNo,
    documentDate: row.documentDate ? row.documentDate.toISOString().split("T")[0] : null,
    note: row.note,
    uploadedBy: row.uploader ? { id: row.uploader.id, fullName: row.uploader.fullName } : null,
    uploadedAt: row.uploadedAt.toISOString(),
  };
}

export const GET = withSuperAdmin(async (_request: NextRequest, context: any) => {
  try {
    const lotId = Number(context.params.id);
    if (!lotId) return validationError("Invalid lot");
    const lot = await prisma.lot.findUnique({ where: { id: lotId }, select: { id: true } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    const documents = await prisma.lotDocument.findMany({
      where: { lotId, archivedAt: null },
      include: { uploader: { select: { id: true, fullName: true } } },
      orderBy: [{ uploadedAt: "desc" }, { id: "desc" }],
    });

    return successResponse(documents.map(formatDocument));
  } catch (error) {
    console.error("List lot documents error:", error);
    return serverError();
  }
});

export const POST = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const lotId = Number(context.params.id);
    if (!lotId) return validationError("Invalid lot");
    const lot = await prisma.lot.findUnique({ where: { id: lotId }, select: { id: true, lotNumber: true } });
    if (!lot) return errorResponse("NOT_FOUND", "Lot not found", 404);

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const category = String(formData.get("category") || "other");
    if (!LOT_DOCUMENT_CATEGORY_VALUES.includes(category as any)) return validationError("Invalid document type");
    if (!file) return validationError("No file provided");

    const validation = validateLotDocumentFile(file);
    if (!validation.ok) return validationError(validation.message);

    const referenceNo = String(formData.get("referenceNo") || "").trim() || null;
    const documentDateRaw = String(formData.get("documentDate") || "").trim();
    const note = String(formData.get("note") || "").trim() || null;
    const documentDate = documentDateRaw ? new Date(`${documentDateRaw}T00:00:00.000Z`) : null;
    if (documentDateRaw && Number.isNaN(documentDate!.getTime())) return validationError("Invalid document date");

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const storageKey = createLotDocumentStorageKey(lotId, file.name);
    const stored = await uploadLotDocumentToBucket({
      key: storageKey,
      buffer,
      contentType: validation.mimeType || file.type || "application/octet-stream",
      originalFileName: file.name,
    });

    const document = await prisma.$transaction(async (tx) => {
      const created = await tx.lotDocument.create({
        data: {
          lotId,
          category: category as any,
          originalFileName: file.name,
          storageKey: stored.storageKey,
          fileUrl: stored.internalUrl,
          mimeType: validation.mimeType || file.type || "application/octet-stream",
          extension: validation.extension,
          fileSize: file.size,
          referenceNo,
          documentDate,
          note,
          uploadedBy: user.userId,
        },
        include: { uploader: { select: { id: true, fullName: true } } },
      });
      await createAuditLog(user.userId, null, "lot_documents", created.id, "create", undefined, {
        lotId,
        category,
        originalFileName: file.name,
      }, getClientIP(request), tx);
      return created;
    });

    return successResponse(formatDocument(document), "Document uploaded", 201);
  } catch (error) {
    console.error("Upload lot document error:", error);
    return serverError();
  }
});

export const DELETE = withSuperAdmin(async (request: NextRequest, context: any, user: JWTPayload) => {
  try {
    const lotId = Number(context.params.id);
    const documentId = Number(request.nextUrl.searchParams.get("documentId") || "");
    if (!lotId || !documentId) return validationError("Invalid document");
    const existing = await prisma.lotDocument.findFirst({ where: { id: documentId, lotId, archivedAt: null } });
    if (!existing) return errorResponse("NOT_FOUND", "Document not found", 404);

    const archived = await prisma.$transaction(async (tx) => {
      const row = await tx.lotDocument.update({
        where: { id: documentId },
        data: { archivedAt: new Date(), archivedBy: user.userId },
        include: { uploader: { select: { id: true, fullName: true } } },
      });
      await createAuditLog(user.userId, null, "lot_documents", documentId, "update", { archivedAt: null }, { archivedAt: row.archivedAt }, getClientIP(request), tx);
      return row;
    });

    return successResponse(formatDocument(archived), "Document archived");
  } catch (error) {
    console.error("Archive lot document error:", error);
    return serverError();
  }
});
