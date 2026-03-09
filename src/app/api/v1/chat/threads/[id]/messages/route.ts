import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError, forbiddenResponse, notFoundResponse, validationError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";
import { chatEvents } from "@/lib/chat-events";

// Helper: verify user can access the given thread
async function canAccess(user: JWTPayload, threadId: number) {
  const thread = await prisma.chatThread.findUnique({ where: { id: threadId } });
  if (!thread) return null;
  if (thread.type === "group") return thread; // everyone can access group
  if (user.role === "super_admin") return thread; // super_admin sees all direct threads
  if (thread.cityId === user.cityId) return thread; // city_admin sees their own direct thread
  return null;
}

// GET - list messages in a thread (newest first, paginated)
export const GET = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const threadId = parseInt((context.params as any).id);
    const thread = await canAccess(user, threadId);
    if (!thread) return forbiddenResponse();

    const page = parseInt(request.nextUrl.searchParams.get("page") || "1");
    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { threadId },
        include: { sender: { select: { id: true, fullName: true, role: true } } },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.chatMessage.count({ where: { threadId } }),
    ]);

    return successResponse({
      messages: messages.map((m) => ({
        id: m.id,
        content: m.content,
        isRead: m.isRead,
        createdAt: m.createdAt.toISOString(),
        sender: { id: m.sender.id, fullName: m.sender.fullName, role: m.sender.role },
        isMine: m.senderId === user.userId,
      })),
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("Chat messages GET error:", error);
    return serverError();
  }
});

// POST - send a message
export const POST = withAuth(async (request: NextRequest, context, user: JWTPayload) => {
  try {
    const threadId = parseInt((context.params as any).id);
    const thread = await canAccess(user, threadId);
    if (!thread) return forbiddenResponse();

    const body = await request.json();
    const content = (body?.content || "").trim();
    if (!content) return validationError("Message cannot be empty");

    const message = await prisma.chatMessage.create({
      data: { threadId, senderId: user.userId, content },
      include: { sender: { select: { id: true, fullName: true, role: true } } },
    });

    const msgPayload = {
      id: message.id,
      content: message.content,
      isRead: message.isRead,
      createdAt: message.createdAt.toISOString(),
      sender: { id: message.sender.id, fullName: message.sender.fullName, role: message.sender.role },
    };

    // Notify all users who can see this thread via SSE
    // For group threads: all users; for direct threads: super_admin + city_admin of that city
    try {
      const thread = await canAccess(user, threadId);
      if (thread) {
        const users = await prisma.user.findMany({
          where: thread.type === "group"
            ? { isActive: true }
            : { isActive: true, OR: [{ role: "super_admin" }, { cityId: thread.cityId }] },
          select: { id: true },
        });
        const userIds = users.map((u) => u.id).filter((id) => id !== user.userId);
        chatEvents.notify(userIds, threadId, { ...msgPayload, isMine: false });
      }
    } catch (e) {
      console.error("SSE notify error:", e);
    }

    return successResponse({ ...msgPayload, isMine: true });
  } catch (error) {
    console.error("Chat messages POST error:", error);
    return serverError();
  }
});
