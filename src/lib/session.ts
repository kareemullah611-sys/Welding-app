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
  } catch {
    // DB unavailable — trust the JWT rather than forcing logout mid-session.
    return true;
  }
}
