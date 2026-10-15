import { NextRequest, NextResponse } from "next/server";
import { verifyOfflineShellTokenEdge, verifyTokenEdge } from "@/lib/jwt-edge";
import { isAllowlistedOfflineRequest } from "@/lib/offline-route-policy";

// Pages that don't require authentication
const publicPaths = ["/login", "/privacy", "/support", "/icon", "/apple-icon", "/api/v1/auth/login", "/api/v1/auth/me", "/api/v1/auth/logout", "/api/health", "/api/ping", "/api/csp-report", "/api/v1/fx-snapshots/sarafi-af/captures", "/api/v1/fx-snapshots/sbp", "/api/v1/fx-snapshots/evidence-retention", "/customer-portal", "/api/v1/customer-portal"];
const STATIC_FILE_EXTENSION_PATTERN = /\.(?:avif|bmp|css|gif|ico|jpeg|jpg|js|json|map|png|svg|txt|webmanifest|webp|woff|woff2)$/i;

function isPublicPath(pathname: string): boolean {
  return publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function getMiddlewareToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.substring(7);
  return request.cookies.get("token")?.value || null;
}

function isLocalPackagedHost(request: NextRequest): boolean {
  const hostname = request.nextUrl.hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function apiUnauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { success: false, error: "UNAUTHORIZED", message: "Invalid or expired token" },
    { status: 401 }
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/v1/")) {
    if (request.headers.get("x-offline-device-token") && isAllowlistedOfflineRequest(pathname, request.method)) {
      return NextResponse.next();
    }
    const token = getMiddlewareToken(request);
    if (!token) return apiUnauthorizedResponse();
    const payload = await verifyTokenEdge(token);
    if (!payload) {
      const response = apiUnauthorizedResponse();
      response.cookies.set("token", "", { httpOnly: true, path: "/", maxAge: 0 });
      return response;
    }
    return NextResponse.next();
  }


  const token = getMiddlewareToken(request);

  // Allow static files
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || STATIC_FILE_EXTENSION_PATTERN.test(pathname)) {
    return NextResponse.next();
  }

  const payload = token ? await verifyTokenEdge(token) : null;
  if (!payload && isLocalPackagedHost(request)) {
    const offlineShellToken = request.cookies.get("offline_shell")?.value;
    if (offlineShellToken && await verifyOfflineShellTokenEdge(offlineShellToken)) {
      return NextResponse.next();
    }
  }

  if (!payload) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    if (token) response.cookies.set("token", "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
