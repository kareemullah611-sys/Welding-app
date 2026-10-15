import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("offline shell token is purpose-bound, role-aware, and accepted for superadmin", async () => {
  process.env.JWT_SECRET ||= "offline-shell-test-secret-at-least-32-characters";
  const { generateOfflineShellToken } = await import("@/lib/auth");
  const { verifyOfflineShellTokenEdge, verifyTokenEdge } = await import("@/lib/jwt-edge");
  const token = generateOfflineShellToken({
    userId: 1,
    username: "owner",
    role: "super_admin",
    cityId: null,
    countryId: null,
  });

  const verified = await verifyOfflineShellTokenEdge(token);
  assert.equal(verified?.role, "super_admin");
  assert.equal(await verifyTokenEdge(token), null);
});

test("offline shell token cannot authorize API routes and only unlocks local packaged pages", () => {
  const middleware = readFileSync("src/middleware.ts", "utf8");
  assert.match(middleware, /pathname\.startsWith\("\/api\/v1\/"\)[\s\S]*?getMiddlewareToken/);
  assert.match(middleware, /isLocalPackagedHost/);
  assert.match(middleware, /request\.cookies\.get\("offline_shell"\)/);
  assert.match(middleware, /verifyOfflineShellTokenEdge/);
});

test("offline login restores only the signed server-issued shell cookie", () => {
  const authHook = readFileSync("src/hooks/useAuth.tsx", "utf8");
  const packagedApi = readFileSync("src/lib/packaged-api.ts", "utf8");
  assert.match(packagedApi, /mrf-packaged-offline-shell-token/);
  assert.match(authHook, /restoreOfflineShellCookie/);
  assert.match(authHook, /offlineShellToken/);
  assert.doesNotMatch(authHook, /jwt\.sign|generateOfflineShellToken/);
});

test("missing offline shell credentials fall through to online renewal", () => {
  const authHook = readFileSync("src/hooks/useAuth.tsx", "utf8");
  const cachedLoginStart = authHook.indexOf("if (packaged && cacheMatches");
  const onlineLoginStart = authHook.indexOf("const online = await tryOnlineLogin", cachedLoginStart);
  const cachedLoginBranch = authHook.slice(cachedLoginStart, onlineLoginStart);

  assert.ok(cachedLoginStart >= 0 && onlineLoginStart > cachedLoginStart);
  assert.doesNotMatch(cachedLoginBranch, /must be renewed online/);
  assert.match(cachedLoginBranch, /restoreOfflineShellCookie\(\)/);
});
