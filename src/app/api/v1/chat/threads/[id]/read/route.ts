import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError, forbiddenResponse } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// PUT - mark all messages in thread as read (messages not sent by me)
export const PUT = withAuth(async (_request: NextRequest, context, user: JWTPayload) => {
  try {
    const threadId = parseInt((context.params as any).id);
    const thread = await prisma.chatThread.findUnique({ where: { id: threadId } });
    if (!thread) return forbiddenResponse();
    if (thread.type === "direct" && user.role === "city_admin" && thread.cityId !== user.cityId) {
      return forbiddenResponse();
    }

    await prisma.chatMessage.updateMany({
      where: { threadId, senderId: { not: user.userId }, isRead: false },
      data: { isRead: true },
    });

    return successResponse({ ok: true });
  } catch (error) {
    console.error("Chat read error:", error);
    return serverError();
  }
});
