import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getTokenFromRequest } from "@/lib/auth";
import { successResponse } from "@/lib/api-response";
import { hashToken } from "@/lib/session";

export async function POST(request: NextRequest) {
  // Logout is safe without CSRF — worst case is the user is signed out (no state change attack).
  const token = getTokenFromRequest(request);
  if (token) {
    try {
      const tokenHash = hashToken(token);
      await prisma.userSession.updateMany({
        where: { tokenHash, isActive: true },
        data: { isActive: false },
      });
    } catch (error) {
      // Don't fail logout if session cleanup fails
      console.error("Session cleanup error (non-fatal):", error);
    }
  }

  const response = successResponse({ message: "Logged out successfully" });
  response.cookies.set("token", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return response;
}
