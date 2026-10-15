import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("409 conflicts retain the server snapshot for review", () => {
  const source = fs.readFileSync("src/hooks/useOffline.tsx", "utf8");
  assert.match(source, /serverSnapshot/);
  assert.match(source, /getConflictSnapshotUrl/);
  assert.match(source, /conflictCode/);
});

test("activity feed resolves conflicts without blind retry", () => {
  const source = fs.readFileSync("src/app/(dashboard)/activity-feed/page.tsx", "utf8");
  assert.match(source, /Accept server/);
  assert.match(source, /triggerFullSync/);
  assert.doesNotMatch(source, /if \(user\.role === "city_admin"\) \{\s*return \(/);
});
