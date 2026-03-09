// Simple in-memory event emitter for chat real-time notifications.
// Each connected SSE client registers a listener keyed by userId.
// When a message is sent, we notify all listeners who have access to that thread.

type ChatListener = (event: { threadId: number; message: any }) => void;

class ChatEventEmitter {
  private listeners = new Map<number, Set<ChatListener>>(); // userId -> Set<listener>

  subscribe(userId: number, listener: ChatListener) {
    if (!this.listeners.has(userId)) {
      this.listeners.set(userId, new Set());
    }
    this.listeners.get(userId)!.add(listener);
    return () => {
      this.listeners.get(userId)?.delete(listener);
      if (this.listeners.get(userId)?.size === 0) {
        this.listeners.delete(userId);
      }
    };
  }

  // Notify specific user IDs about a new message
  notify(userIds: number[], threadId: number, message: any) {
    for (const userId of userIds) {
      const userListeners = this.listeners.get(userId);
      if (userListeners) {
        Array.from(userListeners).forEach((listener) => {
          listener({ threadId, message });
        });
      }
    }
  }
}

// Singleton — shared across all API routes in the same process
export const chatEvents = new ChatEventEmitter();
