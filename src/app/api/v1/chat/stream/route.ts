import { NextRequest } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { chatEvents } from "@/lib/chat-events";

// SSE endpoint for real-time chat messages
// Client connects with: new EventSource("/api/v1/chat/stream")
// Auth is via cookie (sent automatically by the browser)
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      controller.enqueue(encoder.encode(": connected\n\n"));

      // Subscribe to chat events for this user
      const unsubscribe = chatEvents.subscribe(user.userId, (event) => {
        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      });

      // Heartbeat every 30s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 30000);

      // Cleanup on disconnect
      request.signal.addEventListener("abort", () => {
        unsubscribe();
        clearInterval(heartbeat);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
