import crypto from "crypto";
import prisma from "@/lib/prisma";

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** True when the JWT belongs to an active, non-expired server session (if tracked). */
export async function isSessionActive(token: string): Promise<boolean> {
  try {
    const session = await prisma.userSession.findFirst({
      where: { tokenHash: hashToken(token) },
      select: { isActive: true, expiresAt: true },
    });
    // Login always creates a row; missing row = invalid/revoked token.
    if (!session) return false;
    return session.isActive && session.expiresAt > new Date();
  } catch (error) {
    console.error("Session validation failed:", error);
    return false;
  }
}

export async function cleanupExpiredSessions(now = new Date()): Promise<number> {
  try {
    const result = await prisma.userSession.updateMany({
      where: {
        isActive: true,
        expiresAt: { lt: now },
      },
      data: { isActive: false },
    });
    return result.count;
  } catch (error) {
    console.error("Expired session cleanup failed:", error);
    return 0;
  }
}
