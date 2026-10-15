import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settings = readFileSync("src/app/(dashboard)/settings/page.tsx", "utf8");
const listRoute = readFileSync("src/app/api/v1/offline-devices/route.ts", "utf8");

test("superadmin session settings expose trusted offline devices and online controls", () => {
  assert.match(settings, /apiCall\("\/api\/v1\/offline-devices"\)/);
  assert.match(settings, /Trusted offline devices/);
  assert.match(settings, /action: "approve" \| "revoke"/);
  assert.match(settings, /\/api\/v1\/offline-devices\/\$\{id\}\/\$\{action\}/);
  assert.match(settings, /disabled=\{!isOnline/);
});

test("trusted-device API never returns token hashes", () => {
  assert.doesNotMatch(listRoute, /tokenHash:\s*true/);
  assert.match(listRoute, /approvedAt:\s*true/);
  assert.match(listRoute, /revokedAt:\s*true/);
});
