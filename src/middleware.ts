import { NextRequest, NextResponse } from "next/server";

// Pages that don't require authentication
const publicPaths = ["/login", "/api/v1/auth/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths and API routes (API handles its own auth)
  if (publicPaths.some((p) => pathname.startsWith(p)) || pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow static files
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // Check for auth token
  const token = request.cookies.get("token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
