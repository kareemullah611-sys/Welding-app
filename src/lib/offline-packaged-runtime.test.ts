import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("packaged builds enable offline features for Android, Windows, and macOS", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.match(pkg.scripts["package:android:sync"], /NEXT_PUBLIC_OFFLINE_ENABLED=true/);
  assert.match(pkg.scripts["package:android:sync"], /build:packaged/);
  assert.match(pkg.scripts["package:mac:dist"], /build:packaged/);
  assert.match(pkg.scripts["package:win:dist"], /build:packaged/);
  assert.deepEqual(pkg.build.win.target, ["nsis"]);
});

test("Electron packages the shared security header module used by the main process", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.ok(pkg.build.files.includes("scripts/security-headers.cjs"));
  assert.match(read("electron/main.cjs"), /require\("\.\.\/scripts\/security-headers\.cjs"\)/);
});

test("Capacitor schedules a native background runner against bundled assets", () => {
  const config = read("capacitor.config.ts");

  assert.match(config, /webDir:\s*"out"/);
  assert.match(config, /BackgroundRunner/);
  assert.match(config, /runners\/offline-sync\.js/);
  assert.match(config, /autoStart:\s*true/);
  assert.match(config, /interval:\s*15/);
});

test("desktop keeps the renderer alive in the tray for background synchronization", () => {
  const main = read("electron/main.cjs");

  assert.match(main, /new Tray\(/);
  assert.match(main, /process\.platform === "darwin"/);
  assert.match(main, /apple-touch-icon\.png/);
  assert.match(main, /nativeImage/);
  assert.match(main, /resize\(\{ width: 18, height: 18 \}\)/);
  assert.match(main, /Unable to create tray icon/);
  assert.doesNotMatch(main, /app\.disableHardwareAcceleration\(\)/);
  assert.match(main, /SkiaGraphite/);
  assert.match(main, /event\.preventDefault\(\)/);
  assert.match(main, /mainWindow\.hide\(\)/);
  assert.doesNotMatch(main, /if \(process\.platform !== "darwin"\) app\.quit\(\)/);
});

test("desktop creates its main window before waiting for remote health", () => {
  const main = read("electron/main.cjs");
  const readyBlock = main.slice(main.indexOf("app.whenReady().then"));
  const createWindowAt = readyBlock.indexOf("mainWindow = createWindow(localPort)");
  const healthProbeAt = readyBlock.indexOf("const serverHealthy = await probeRemoteHealth()");

  assert.ok(createWindowAt >= 0);
  assert.ok(healthProbeAt >= 0);
  assert.ok(createWindowAt < healthProbeAt);
});

test("desktop startup never blocks the local offline shell on a server warning dialog", () => {
  const main = read("electron/main.cjs");

  assert.doesNotMatch(main, /dialog\.showMessageBox/);
  assert.match(main, /Remote server unavailable; continuing with the local offline shell/);
});

test("desktop uses one stable local origin so offline data survives restarts", () => {
  const main = read("electron/main.cjs");

  assert.match(main, /LOCAL_APP_PORT = 47819/);
  assert.match(main, /server\.listen\(LOCAL_APP_PORT/);
  assert.doesNotMatch(main, /server\.listen\(0,/);
  assert.match(main, /requestSingleInstanceLock/);
});

test("packaged UI starts offline until server reachability is proven", () => {
  const offlineProvider = read("src/hooks/useOffline.tsx");

  assert.match(offlineProvider, /getPackagedServerReachable/);
  assert.match(offlineProvider, /useState\(\(\) => isPackagedOfflineActive\(\)\)/);
  assert.match(offlineProvider, /useState\(\(\) => isPackagedOfflineActive\(\) \? getPackagedServerReachable\(\) : true\)/);
});

test("full sync prepares every godown stock cache required by offline sales", () => {
  const hydrate = read("src/lib/offline-sync-hydrate.ts");

  assert.match(hydrate, /prefetchGodownStockCaches/);
  assert.match(hydrate, /data\.godowns/);
});

test("offline payment and Haji selectors use synchronized settlement metadata", () => {
  const payload = read("src/lib/offline-sync-payload.server.ts");
  const payments = read("src/app/(dashboard)/payments/page.tsx");
  const haji = read("src/app/(dashboard)/haji-transfers/page.tsx");

  assert.match(payload, /superAdminBankAccounts/);
  assert.match(payments, /if \(!isOnline\)[\s\S]*settlementByCurrency/);
  assert.match(haji, /if \(!isOnline\)[\s\S]*settlementByCurrency/);
});

test("mobile background sync uses a revocable device credential, never the login password", () => {
  const schema = read("prisma/schema.prisma");
  const runner = read("public/runners/offline-sync.js");
  const middleware = read("src/lib/middleware.ts");

  assert.match(schema, /model OfflineSyncDevice/);
  assert.match(runner, /x-offline-device-token/);
  assert.doesNotMatch(runner, /password/i);
  assert.match(middleware, /authenticateOfflineSyncDevice/);
});

test("newly covered transaction modules have an explicit safe offline policy", () => {
  const policy = read("src/lib/offline-route-policy.ts");

  assert.match(policy, /"\/api\/v1\/super-admin-account-transfers"/);
  assert.match(policy, /Liability routes are intentionally online-only/i);
  assert.match(policy, /delivery routes are intentionally online-only/i);
});

test("offline device migration is additive and background completions reconcile on foreground", () => {
  const migration = read("prisma/migrations/20261006090000_add_offline_sync_devices/migration.sql");
  const offlineProvider = read("src/hooks/useOffline.tsx");

  assert.match(migration, /CREATE TABLE "offline_sync_devices"/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM/i);
  assert.match(offlineProvider, /readNativeBackgroundCompletions/);
  assert.match(offlineProvider, /reconcileSyncedIds\(item, completion\.data\)/);
});

test("all offline modules share one versioned IndexedDB schema initializer", () => {
  const cache = read("src/lib/offline-cache.ts");
  const consumers = [
    "src/hooks/useOffline.tsx",
    "src/hooks/useApi.ts",
    "src/lib/offline-full-sync.ts",
    "src/lib/offline-seed-import.ts",
    "src/lib/offline-inventory.ts",
    "src/lib/offline-sync-hydrate.ts",
  ];

  assert.match(cache, /OFFLINE_DB_VERSION = 7/);
  assert.match(cache, /export function openOfflineDatabase/);
  assert.match(cache, /OFFLINE_ID_MAP_STORE/);
  assert.match(cache, /OFFLINE_FULL_SYNC_META_STORE/);
  for (const consumer of consumers) {
    const source = read(consumer);
    assert.match(source, /openOfflineDatabase/);
    assert.doesNotMatch(source, /indexedDB\.open/);
  }
});
