const fs = require("node:fs");
const test = require("node:test");
const assert = require("node:assert/strict");

const main = fs.readFileSync("electron/main.cjs", "utf8");
const preload = fs.readFileSync("electron/preload.cjs", "utf8");
const offlineProvider = fs.readFileSync("src/hooks/useOffline.tsx", "utf8");

test("desktop app starts with the operating system for background synchronization", () => {
  assert.match(main, /setLoginItemSettings\(/);
  assert.match(main, /openAtLogin:\s*true/);
  assert.match(main, /--background/);
});

test("desktop app triggers synchronization periodically and after wake", () => {
  assert.match(main, /powerMonitor\.on\("resume"/);
  assert.match(main, /powerMonitor\.on\("unlock-screen"/);
  assert.match(main, /electron:background-sync-trigger/);
  assert.match(main, /setInterval\(/);
});

test("renderer receives native background synchronization triggers", () => {
  assert.match(preload, /onBackgroundSyncTrigger/);
  assert.match(preload, /electron:background-sync-trigger/);
  assert.match(offlineProvider, /onBackgroundSyncTrigger/);
  assert.match(offlineProvider, /new Event\("online"\)/);
});
