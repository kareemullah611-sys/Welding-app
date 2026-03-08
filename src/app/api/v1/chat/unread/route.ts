import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET - total unread message count across all accessible threads
export const GET = withAuth(async (_request: NextRequest, _context, user: JWTPayload) => {
  try {
    // Find accessible thread IDs
    let threadIds: number[] = [];

    const general = await prisma.chatThread.findFirst({ where: { type: "group", name: "General" } });
    if (general) threadIds.push(general.id);

    if (user.role === "city_admin") {
      const direct = await prisma.chatThread.findFirst({ where: { type: "direct", cityId: user.cityId! } });
      if (direct) threadIds.push(direct.id);
    } else {
      const allDirect = await prisma.chatThread.findMany({ where: { type: "direct" }, select: { id: true } });
      threadIds.push(...allDirect.map((t) => t.id));
    }

    const count = await prisma.chatMessage.count({
      where: { threadId: { in: threadIds }, senderId: { not: user.userId }, isRead: false },
    });

    return successResponse({ count });
  } catch (error) {
    console.error("Chat unread error:", error);
    return serverError();
  }
});
