import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { withSuperAdmin } from "@/lib/middleware";
import { errorResponse, serverError, validationError } from "@/lib/api-response";
import { getLotDocumentDownloadUrl } from "@/lib/railway-bucket";

export const GET = withSuperAdmin(async (request: NextRequest, context: any) => {
  try {
    const lotId = Number(context.params.id);
    const documentId = Number(context.params.documentId);
    if (!lotId || !documentId) return validationError("Invalid document");

    const document = await prisma.lotDocument.findFirst({
      where: { id: documentId, lotId, archivedAt: null },
      select: {
        storageKey: true,
        originalFileName: true,
        mimeType: true,
      },
    });
    if (!document) return errorResponse("NOT_FOUND", "Document not found", 404);

    const url = await getLotDocumentDownloadUrl({
      key: document.storageKey,
      originalFileName: document.originalFileName,
      contentType: document.mimeType,
    });

    if (request.nextUrl.searchParams.get("preview") === "1") {
      const upstream = await fetch(url, { cache: "no-store" });
      if (!upstream.ok || !upstream.body) return serverError("Unable to load document preview");
      const safeFileName = document.originalFileName.replace(/[\r\n"]/g, "").trim() || "lot-document";
      return new NextResponse(upstream.body, {
        status: 200,
        headers: {
          "Content-Type": document.mimeType || upstream.headers.get("content-type") || "application/octet-stream",
          "Content-Disposition": `inline; filename="${safeFileName}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return NextResponse.redirect(url, 302);
  } catch (error) {
    console.error("Download lot document error:", error);
    return serverError();
  }
});
