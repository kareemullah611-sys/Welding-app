import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { PUT as changeUsername } from "@/app/api/v1/auth/change-username/route";
import { POST as deleteAccount } from "@/app/api/v1/auth/delete-account/route";

// These routes authenticate from the `token` cookie, so a cross-site form post
// would otherwise carry a valid session. isCsrfSafe must run before any
// credential work, so a foreign Origin is rejected with 403 CSRF_ERROR while a
// same-origin request proceeds far enough to fail authentication instead.
function cookieAuthedRequest(url: string, method: "PUT" | "POST", origin?: string) {
  return new NextRequest(url, {
    method,
    headers: {
      cookie: "token=not-a-real-token",
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
    },
    body: JSON.stringify({}),
  });
}

async function csrfErrorCode(response: Response) {
  const body = (await response.json()) as { error?: string };
  return { status: response.status, error: body.error };
}

const ROUTES = [
  {
    name: "PUT /api/v1/auth/change-username",
    method: "PUT" as const,
    url: "http://localhost:3000/api/v1/auth/change-username",
    handler: changeUsername,
  },
  {
    name: "POST /api/v1/auth/delete-account",
    method: "POST" as const,
    url: "http://localhost:3000/api/v1/auth/delete-account",
    handler: deleteAccount,
  },
];

for (const route of ROUTES) {
  test(`${route.name} rejects a cross-site Origin with 403 CSRF_ERROR`, async () => {
    const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
    try {
      const response = await route.handler(cookieAuthedRequest(route.url, route.method, "https://evil.example.test") as never);
      assert.deepEqual(await csrfErrorCode(response), { status: 403, error: "CSRF_ERROR" });
    } finally {
      if (previousAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
    }
  });

  test(`${route.name} accepts the configured app Origin and proceeds to authentication`, async () => {
    const previousAppUrl = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test";
    try {
      const response = await route.handler(cookieAuthedRequest(route.url, route.method, "https://app.example.test") as never);
      const { status, error } = await csrfErrorCode(response);
      assert.notEqual(error, "CSRF_ERROR", "same-origin request must not be blocked by CSRF");
      assert.equal(status, 401, "same-origin request should fail on the invalid token instead");
    } finally {
      if (previousAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = previousAppUrl;
    }
  });
}

test("change-username and delete-account both call isCsrfSafe before touching the token", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of [
    "src/app/api/v1/auth/change-username/route.ts",
    "src/app/api/v1/auth/delete-account/route.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /isCsrfSafe\(request\)/, `${file} must apply the CSRF guard`);
    assert.ok(
      source.indexOf("isCsrfSafe(request)") < source.indexOf("getTokenFromRequest(request)"),
      `${file} must run the CSRF guard before token extraction`
    );
  }
});
