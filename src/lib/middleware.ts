import { NextRequest } from "next/server";
import { getTokenFromRequest, JWTPayload, verifyToken } from "@/lib/auth";
import { isSessionActive } from "@/lib/session";
import { unauthorizedResponse, forbiddenResponse } from "@/lib/api-response";
import prisma from "@/lib/prisma";
import { Prisma, PrismaClient } from "@prisma/client";

export type ApiHandler = (
  request: NextRequest,
  context: { params: Record<string, string> },
  user: JWTPayload
) => Promise<Response>;

// ============================================================
// CSRF PROTECTION
// Verify that state-changing requests (POST/PUT/PATCH/DELETE)
// originate from our own app, not a third-party page.
// Requests that carry only a Bearer token (no cookie) are
// inherently CSRF-safe — we only check cookie-authenticated calls.
// ============================================================
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isCsrfSafe(request: NextRequest): boolean {
  // Only mutation methods need CSRF protection
  if (!MUTATION_METHODS.has(request.method)) return true;

  // If the request uses Authorization header (Bearer token) it cannot be
  // triggered by a cross-origin HTML form or navigation — safe.
  if (request.headers.get("authorization")?.startsWith("Bearer ")) return true;

  // For cookie-authenticated requests, verify Origin or Referer
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  // Allow same-origin requests and requests from the configured app URL
  const requestOrigin = origin || (referer ? new URL(referer).origin : null);

  if (!requestOrigin) {
    // In production, cookie-authenticated mutations must include Origin or Referer.
    if (process.env.NODE_ENV === "production") return false;
    // Dev/test: allow server-to-server / curl without Origin
    return true;
  }

  // In development allow localhost on any port
  if (process.env.NODE_ENV !== "production") {
    if (requestOrigin.startsWith("http://localhost") || requestOrigin.startsWith("http://127.0.0.1")) {
      return true;
    }
  }

  if (appOrigin && requestOrigin === appOrigin) return true;

  // Electron desktop proxies API via 127.0.0.1 (rewrites Origin; keep fallback for forwarded requests)
  if (
    appOrigin &&
    (requestOrigin.startsWith("http://127.0.0.1") || requestOrigin.startsWith("http://localhost")) &&
    request.headers.get("x-forwarded-proto")
  ) {
    return true;
  }

  // Allow same host (covers both http and https variants when behind a proxy)
  const requestHost = new URL(requestOrigin).hostname;
  const host = request.headers.get("host");
  if (host && requestHost === host.split(":")[0]) return true;

  return false;
}

function csrfError(): Response {
  return new Response(
    JSON.stringify({ success: false, error: "CSRF_ERROR", message: "Cross-site request blocked" }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  );
}

// Auth middleware - verifies JWT and attaches user
export function withAuth(handler: ApiHandler) {
  return async (request: NextRequest, context: { params: Record<string, string> }) => {
    if (!isCsrfSafe(request)) return csrfError();
    const token = getTokenFromRequest(request);
    if (!token) return unauthorizedResponse("Invalid or expired token");
    const user = verifyToken(token);
    if (!user) return unauthorizedResponse("Invalid or expired token");
    if (!(await isSessionActive(token))) {
      return unauthorizedResponse("Session expired or revoked");
    }
    return handler(request, context, user);
  };
}

// Role middleware - requires specific role
export function withRole(role: "super_admin" | "city_admin", handler: ApiHandler) {
  return withAuth(async (request, context, user) => {
    if (user.role !== role) {
      return forbiddenResponse(`This action requires ${role} role`);
    }
    return handler(request, context, user);
  });
}

// Super admin only
export function withSuperAdmin(handler: ApiHandler) {
  return withRole("super_admin", handler);
}

// City scope middleware - auto-filters by city for city_admin
export function getCityScope(user: JWTPayload, requestedCityId?: number): number | undefined {
  if (user.role === "city_admin") {
    return user.cityId!;
  }
  // Super admin can specify city or see all
  return requestedCityId || undefined;
}

// Audit log helper
export async function createAuditLog(
  userId: number,
  cityId: number | null,
  entityType: string,
  entityId: number,
  action: "create" | "update" | "delete" | "cancel" | "restore" | "hard_delete",
  oldValues?: Record<string, unknown>,
  newValues?: Record<string, unknown>,
  ipAddress?: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  try {
    await db.auditLog.create({
      data: {
        userId,
        cityId,
        entityType,
        entityId,
        action,
        oldValues: (oldValues as any) || undefined,
        newValues: (newValues as any) || undefined,
        ipAddress,
      },
    });
  } catch (error) {
    console.error("Failed to create audit log:", error);
  }
}

// Get client IP from request
export function getClientIP(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
