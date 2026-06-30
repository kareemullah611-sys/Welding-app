import assert from "node:assert/strict";
import test from "node:test";

import { NextRequest } from "next/server";
import { GET } from "@/app/api/v1/auth/me/route";

test("auth/me returns null without a token", async () => {
  const request = new NextRequest("http://localhost:3000/api/v1/auth/me");
  const response = await GET(request);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data, null);
});

test("auth/me clears stale cookie and returns null for invalid token", async () => {
  const request = new NextRequest("http://localhost:3000/api/v1/auth/me", {
    headers: { cookie: "token=not-a-valid-jwt" },
  });
  const response = await GET(request);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.data, null);
  const setCookie = response.headers.get("set-cookie") || "";
  assert.match(setCookie, /token=;/);
  assert.match(setCookie, /Max-Age=0/i);
});
