import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, errorResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { uploadToCloudinary, deleteFromCloudinary } from "@/lib/cloudinary";

const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
const MAX_SIZE = 8 * 1024 * 1024; // 8MB

// POST /api/v1/upload
// Body: multipart/form-data with fields: file, entityType (payment|expense|haji_transfer), entityId
export const POST = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const entityType = formData.get("entityType") as string | null;
    const entityIdStr = formData.get("entityId") as string | null;

    if (!file) return errorResponse("VALIDATION_ERROR", "No file provided");
    if (!entityType || !["payment", "expense", "haji_transfer"].includes(entityType))
      return errorResponse("VALIDATION_ERROR", "Invalid entityType");
    const entityId = parseInt(entityIdStr || "");
    if (!entityId) return errorResponse("VALIDATION_ERROR", "Invalid entityId");

    const ext = ALLOWED_TYPES[file.type];
    if (!ext) return errorResponse("VALIDATION_ERROR", "Only JPEG, PNG, WebP and PDF allowed");
    if (file.size > MAX_SIZE) return errorResponse("VALIDATION_ERROR", "File must be under 8MB");

    const publicId = `${entityType}-${entityId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const { url, publicId: cloudinaryId } = await uploadToCloudinary(buffer, publicId);

    const entityFk =
      entityType === "payment" ? { paymentEntityId: entityId } :
      entityType === "expense" ? { expenseEntityId: entityId } :
      { hajiTransferEntityId: entityId };

    const attachment = await prisma.attachment.create({
      data: {
        entityType: entityType as any,
        entityId,
        fileName: file.name,
        // Store "cloudinaryUrl|||cloudinaryPublicId" so we can delete later
        filePath: `${url}|||${cloudinaryId}`,
        fileType: ext,
        fileSize: file.size,
        uploadedBy: user.userId,
        ...entityFk,
      },
    });

    return successResponse({
      id: attachment.id,
      fileName: attachment.fileName,
      filePath: url,    // return clean URL to the client
      fileType: attachment.fileType,
      fileSize: attachment.fileSize,
    }, "File uploaded", 201);
  } catch (error) {
    console.error("Upload error:", error);
    return serverError();
  }
});

// DELETE /api/v1/upload?id=X
export const DELETE = withAuth(async (request: NextRequest, _context, user: JWTPayload) => {
  try {
    const id = parseInt(request.nextUrl.searchParams.get("id") || "");
    if (!id) return errorResponse("VALIDATION_ERROR", "id required");

    const attachment = await prisma.attachment.findUnique({ where: { id } });
    if (!attachment) return errorResponse("NOT_FOUND", "Attachment not found", 404);
    if (attachment.uploadedBy !== user.userId && user.role !== "super_admin")
      return errorResponse("FORBIDDEN", "Not allowed", 403);

    // filePath is stored as "cloudinaryUrl|||cloudinaryPublicId"
    const parts = attachment.filePath.split("|||");
    const cloudinaryId = parts[1];
    if (cloudinaryId) {
      try {
        await deleteFromCloudinary(cloudinaryId);
      } catch (e) {
        console.error("Cloudinary delete error:", e);
      }
    }

    await prisma.attachment.delete({ where: { id } });
    return successResponse(null, "Deleted");
  } catch (error) {
    return serverError();
  }
});
