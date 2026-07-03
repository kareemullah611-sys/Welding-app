import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { getClientIP, isCsrfSafe, withAuth } from "./middleware";
import { middleware } from "../middleware";
import { generateToken } from "./auth";

function mutationRequest(headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/v1/test", { method: "POST", headers });
}

test("production rejects cookie mutation without Origin or Referer", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  try {
    assert.equal(isCsrfSafe(mutationRequest()), false);
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
  }
});

test("production allows Bearer token without Origin", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.equal(
      isCsrfSafe(mutationRequest({ authorization: "Bearer test-token" })),
      true
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
  }
});

test("production allows mutation when Origin matches app URL", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NODE_ENV = "production";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";
  try {
    assert.equal(
      isCsrfSafe(mutationRequest({ origin: "https://app.example.com" })),
      true
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
  }
});

test("production rejects Host-header-only CSRF fallback unless explicitly trusted", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  const prevTrustHost = process.env.TRUST_HOST_HEADER_CSRF;
  process.env.NODE_ENV = "production";
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.TRUST_HOST_HEADER_CSRF;
  try {
    assert.equal(
      isCsrfSafe(mutationRequest({
        origin: "https://app.example.com",
        host: "app.example.com",
      })),
      false
    );
    process.env.TRUST_HOST_HEADER_CSRF = "true";
    assert.equal(
      isCsrfSafe(mutationRequest({
        origin: "https://app.example.com",
        host: "app.example.com",
      })),
      true
    );
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevAppUrl) process.env.NEXT_PUBLIC_APP_URL = prevAppUrl;
    else delete process.env.NEXT_PUBLIC_APP_URL;
    if (prevTrustHost) process.env.TRUST_HOST_HEADER_CSRF = prevTrustHost;
    else delete process.env.TRUST_HOST_HEADER_CSRF;
  }
});

test("CSP report endpoint is public", async () => {
  const response = await middleware(new NextRequest("http://localhost/api/csp-report", { method: "POST" }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("development allows mutation without Origin", () => {
  const prevNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    assert.equal(isCsrfSafe(mutationRequest()), true);
  } finally {
    process.env.NODE_ENV = prevNodeEnv;
  }
});

test("middleware blocks protected API v1 routes without a token", async () => {
  const response = await middleware(new NextRequest("http://localhost/api/v1/customers"));
  const payload = await response.json();

  assert.equal(response.status, 401);
  assert.equal(payload.success, false);
  assert.equal(payload.error, "UNAUTHORIZED");
});

test("middleware allows public API auth routes without a token", async () => {
  const response = await middleware(new NextRequest("http://localhost/api/v1/auth/login"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
});

test("getClientIP ignores spoofable forwarded headers unless trusted", () => {
  const previousTrustProxy = process.env.TRUST_PROXY_HEADERS;
  delete process.env.TRUST_PROXY_HEADERS;
  try {
    const request = new NextRequest("http://localhost/api/v1/auth/login", {
      headers: {
        "x-forwarded-for": "203.0.113.10",
        "x-real-ip": "203.0.113.11",
      },
    });

    assert.equal(getClientIP(request), "unknown");
  } finally {
    process.env.TRUST_PROXY_HEADERS = previousTrustProxy;
  }
});

test("getClientIP uses forwarded headers only when proxy headers are trusted", () => {
  const previousTrustProxy = process.env.TRUST_PROXY_HEADERS;
  process.env.TRUST_PROXY_HEADERS = "true";
  try {
    const request = new NextRequest("http://localhost/api/v1/auth/login", {
      headers: { "x-forwarded-for": "203.0.113.10, 10.0.0.2" },
    });

    assert.equal(getClientIP(request), "203.0.113.10");
  } finally {
    process.env.TRUST_PROXY_HEADERS = previousTrustProxy;
  }
});

test("withAuth rejects JWT claims that no longer match the database user", async () => {
  process.env.JWT_SECRET ||= "test-secret-with-at-least-32-characters";
  const prismaModule = await import("./prisma");
  const originalFindFirst = prismaModule.default.userSession.findFirst;
  const originalFindUnique = prismaModule.default.user.findUnique;

  (prismaModule.default.userSession as any).findFirst = async () => ({
    isActive: true,
    expiresAt: new Date(Date.now() + 60_000),
  });
  (prismaModule.default.user as any).findUnique = async () => ({
    id: 1,
    username: "city-user",
    role: "super_admin",
    cityId: null,
    city: null,
    isActive: true,
  });

  try {
    const token = generateToken({
      userId: 1,
      username: "city-user",
      role: "city_admin",
      cityId: 2,
      countryId: 1,
    });
    const handler = withAuth(async () => Response.json({ success: true }));
    const response = await handler(
      new NextRequest("http://localhost/api/v1/customers", {
        headers: { authorization: `Bearer ${token}` },
      }),
      { params: {} }
    );

    assert.equal(response.status, 401);
  } finally {
    (prismaModule.default.userSession as any).findFirst = originalFindFirst;
    (prismaModule.default.user as any).findUnique = originalFindUnique;
  }
});
