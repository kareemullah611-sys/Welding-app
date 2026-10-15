import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync(
  "prisma/migrations/20261009100000_add_offline_device_approval/migration.sql",
  "utf8",
);
const deviceAuth = readFileSync("src/lib/offline-device-auth.ts", "utf8");

test("offline device trust migration is additive and preserves existing devices", () => {
  assert.match(migration, /ADD COLUMN "approved_at"/);
  assert.match(migration, /SET "approved_at" = "created_at"/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
});

test("offline device credentials require explicit trusted-device state", () => {
  assert.match(schema, /approvedAt\s+DateTime\s+@map\("approved_at"\)/);
  assert.match(deviceAuth, /approvedAt:\s*new Date\(\)/);
  assert.match(deviceAuth, /!device\.approvedAt/);
  assert.match(deviceAuth, /device\.revokedAt/);
});

test("offline device approval and revocation endpoints are online-session-only and idempotent", () => {
  const approve = readFileSync("src/app/api/v1/offline-devices/[id]/approve/route.ts", "utf8");
  const revoke = readFileSync("src/app/api/v1/offline-devices/[id]/revoke/route.ts", "utf8");
  const policy = readFileSync("src/lib/offline-route-policy.ts", "utf8");

  assert.match(approve, /updateMany/);
  assert.match(approve, /approvedAt:\s*new Date\(\)/);
  assert.match(approve, /revokedAt:\s*null/);
  assert.match(revoke, /updateMany/);
  assert.match(revoke, /revokedAt:\s*new Date\(\)/);
  assert.doesNotMatch(policy, /offline-devices/);
});

test("revocable device credentials reach only allowlisted sync requests", () => {
  const routePolicy = readFileSync("src/lib/offline-route-policy.ts", "utf8");
  const edgeMiddleware = readFileSync("src/middleware.ts", "utf8");
  const apiMiddleware = readFileSync("src/lib/middleware.ts", "utf8");
  const fullSync = readFileSync("src/lib/offline-full-sync.ts", "utf8");
  const offlineProvider = readFileSync("src/hooks/useOffline.tsx", "utf8");
  const authProvider = readFileSync("src/hooks/useAuth.tsx", "utf8");

  assert.match(routePolicy, /isAllowlistedOfflineRequest/);
  assert.match(routePolicy, /normalizedMethod === "GET"[\s\S]*?\/api\/v1\/offline\/sync-all/);
  assert.match(edgeMiddleware, /isAllowlistedOfflineRequest/);
  assert.match(apiMiddleware, /isAllowlistedOfflineRequest/);
  assert.match(fullSync, /x-offline-device-token/);
  assert.match(fullSync, /mrf-offline-device-rejected/);
  assert.match(offlineProvider, /mrf-offline-device-rejected/);
  assert.match(authProvider, /mrf-offline-device-rejected/);
});
