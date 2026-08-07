import assert from "node:assert/strict";
import test from "node:test";

import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";

test("verifyToken rejects malformed JWT payloads", async () => {
  process.env.JWT_SECRET ||= "test-secret-with-at-least-32-characters";
  const { verifyToken } = await import("./auth");

  const token = jwt.sign(
    {
      userId: "1",
      username: "superadmin",
      role: "admin",
      cityId: null,
      countryId: null,
    },
    process.env.JWT_SECRET
  );

  assert.equal(verifyToken(token), null);
});

test("secure auth cookies are enabled for HTTPS deployments outside production", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
  Object.assign(process.env, { NODE_ENV: "development" });
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.com";

  try {
    const { shouldUseSecureAuthCookie } = await import("./auth");
    assert.equal(
      shouldUseSecureAuthCookie(new NextRequest("http://localhost/api/v1/auth/login")),
      true
    );
  } finally {
    if (previousNodeEnv) Object.assign(process.env, { NODE_ENV: previousNodeEnv });
    else delete (process.env as Record<string, string | undefined>).NODE_ENV;
    process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
  }
});
