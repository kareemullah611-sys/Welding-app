import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getTokenFromRequest } from "@/lib/auth";
import { successResponse } from "@/lib/api-response";
import { hashToken } from "@/lib/session";
import { isCsrfSafe } from "@/lib/middleware";

export async function POST(request: NextRequest) {
  if (!isCsrfSafe(request)) {
    return new Response(
      JSON.stringify({ success: false, error: "CSRF_ERROR", message: "Cross-site request blocked" }),
      { status: 403, headers: { "Content-Type": "application/json" } }
    );
  }

  // Deactivate the session
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
