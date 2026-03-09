import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError, forbiddenResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { uploadToCloudinary } from "@/lib/cloudinary";
import { chatEvents } from "@/lib/chat-events";

const ALLOWED_TYPES: Record<string, { ext: string; messageType: "image" | "file" | "voice" }> = {
  "image/jpeg":  { ext: "jpg",  messageType: "image" },
  "image/jpg":   { ext: "jpg",  messageType: "image" },
  "image/png":   { ext: "png",  messageType: "image" },
  "image/webp":  { ext: "webp", messageType: "image" },
  "application/pdf": { ext: "pdf", messageType: "file" },
  "audio/webm":  { ext: "webm", messageType: "voice" },
  "audio/ogg":   { ext: "ogg",  messageType: "voice" },
  "audio/mp4":   { ext: "mp4",  messageType: "voice" },
  "audio/mpeg":  { ext: "mp3",  messageType: "voice" },
  "audio/wav":   { ext: "wav",  messageType: "voice" },
};
const MAX_SIZE = 10 * 1024 * 1024; // 10MB

async function canAccess(user: JWTPayload, threadId: number) {
  const thread = await prisma.chatThread.findUnique({ where: { id: threadId } });
  if (!thread) return null;
  if (thread.type === "group") return thread;
  if (user.role === "super_admin") return thread;
  if (thread.cityId === user.cityId) return thread;
  return null;
}

export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const threadId = parseInt((context.params as any).id);
    const thread = await canAccess(user, threadId);
    if (!thread) return forbiddenResponse();

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    if (!file) return validationError("No file provided");

    const allowed = ALLOWED_TYPES[file.type];
    if (!allowed) return validationError("Unsupported file type. Allowed: images (jpg/png/webp), PDF, audio");
    if (file.size > MAX_SIZE) return validationError("File must be under 10MB");

    const publicId = `chat-${threadId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const { url } = await uploadToCloudinary(buffer, publicId);

    const message = await prisma.chatMessage.create({
      data: {
        threadId,
        senderId: user.userId,
        content: "",
        messageType: allowed.messageType,
        fileUrl: url,
        fileName: file.name,
        fileSize: file.size,
      },
      include: { sender: { select: { id: true, fullName: true, role: true } } },
    });

    const msgPayload = {
      id: message.id,
      content: message.content,
      messageType: message.messageType,
      fileUrl: message.fileUrl,
      fileName: message.fileName,
      fileSize: message.fileSize,
      isRead: message.isRead,
      createdAt: message.createdAt.toISOString(),
      sender: { id: message.sender.id, fullName: message.sender.fullName, role: message.sender.role },
    };

    // Notify other users via SSE
    try {
      const users = await prisma.user.findMany({
        where: thread.type === "group"
          ? { isActive: true }
          : { isActive: true, OR: [{ role: "super_admin" }, { cityId: thread.cityId }] },
        select: { id: true },
      });
      const userIds = users.map((u) => u.id).filter((id) => id !== user.userId);
      chatEvents.notify(userIds, threadId, { ...msgPayload, isMine: false });
    } catch (e) {
      console.error("SSE notify error:", e);
    }

    return successResponse({ ...msgPayload, isMine: true }, "File sent", 201);
  } catch (error) {
    console.error("Chat upload error:", error);
    return serverError();
  }
});
