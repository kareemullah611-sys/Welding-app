import { NextRequest, NextResponse } from "next/server";
import { verifyTokenEdge } from "@/lib/jwt-edge";

// Pages that don't require authentication
const publicPaths = ["/login", "/api/v1/auth/login", "/api/v1/auth/me", "/api/v1/auth/logout", "/api/health", "/api/ping", "/api/csp-report", "/api/v1/fx-snapshots/sarafi-af/captures", "/customer-portal", "/api/v1/customer-portal"];
const STATIC_FILE_EXTENSION_PATTERN = /\.(?:avif|bmp|css|gif|ico|jpeg|jpg|js|json|map|png|svg|txt|webmanifest|webp|woff|woff2)$/i;

function isPublicPath(pathname: string): boolean {
  return publicPaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function getMiddlewareToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.substring(7);
  return request.cookies.get("token")?.value || null;
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

  const token = getMiddlewareToken(request);

  if (pathname.startsWith("/api/v1/")) {
    if (!token) return apiUnauthorizedResponse();
    const payload = await verifyTokenEdge(token);
    if (!payload) {
      const response = apiUnauthorizedResponse();
      response.cookies.set("token", "", { httpOnly: true, path: "/", maxAge: 0 });
      return response;
    }
    return NextResponse.next();
  }

  // Allow static files
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || STATIC_FILE_EXTENSION_PATTERN.test(pathname)) {
    return NextResponse.next();
  }

  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const payload = await verifyTokenEdge(token);
  if (!payload) {
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.set("token", "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
