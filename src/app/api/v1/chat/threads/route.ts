import { NextRequest } from "next/server";
import prisma from "@/lib/prisma";
import { withAuth } from "@/lib/middleware";
import { successResponse, serverError } from "@/lib/api-response";
import { JWTPayload } from "@/lib/auth";

// GET - list threads visible to the current user
export const GET = withAuth(async (_request: NextRequest, _context, user: JWTPayload) => {
  try {
    // Ensure the General group thread exists
    let general = await prisma.chatThread.findFirst({ where: { type: "group", name: "General" } });
    if (!general) {
      general = await prisma.chatThread.create({ data: { type: "group", name: "General" } });
    }

    // For city_admin: their own direct thread + general
    // For super_admin: all direct threads + general
    let directThreads;
    if (user.role === "city_admin") {
      // Find or create their direct thread
      let direct = await prisma.chatThread.findFirst({ where: { type: "direct", cityId: user.cityId! } });
      if (!direct) {
        direct = await prisma.chatThread.create({ data: { type: "direct", cityId: user.cityId! } });
      }
      directThreads = [direct];
    } else {
      // super_admin sees all direct threads
      directThreads = await prisma.chatThread.findMany({
        where: { type: "direct" },
        include: { city: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      });
    }

    // Fetch last message + unread count for each thread
    const threadIds = [general.id, ...directThreads.map((t) => t.id)];

    const lastMessages = await Promise.all(
      threadIds.map((id) =>
        prisma.chatMessage.findFirst({
          where: { threadId: id },
          orderBy: { createdAt: "desc" },
          include: { sender: { select: { id: true, fullName: true, role: true } } },
        })
      )
    );

    const unreadCounts = await Promise.all(
      threadIds.map((id) =>
        prisma.chatMessage.count({
          where: { threadId: id, isRead: false, senderId: { not: user.userId } },
        })
      )
    );

    const enrichThread = (thread: any, idx: number) => ({
      id: thread.id,
      type: thread.type,
      name: thread.name || (thread.city ? thread.city.name : null),
      city: thread.city || null,
      lastMessage: lastMessages[idx]
        ? {
            content: lastMessages[idx]!.content,
            senderName: lastMessages[idx]!.sender.fullName,
            createdAt: lastMessages[idx]!.createdAt.toISOString(),
          }
        : null,
      unreadCount: unreadCounts[idx],
    });

    // General thread is always first
    const generalEnriched = enrichThread({ ...general, city: null }, 0);
    const directEnriched = directThreads.map((t, i) => enrichThread(t, i + 1));

    return successResponse({ threads: [generalEnriched, ...directEnriched] });
  } catch (error) {
    console.error("Chat threads error:", error);
    return serverError();
  }
});
