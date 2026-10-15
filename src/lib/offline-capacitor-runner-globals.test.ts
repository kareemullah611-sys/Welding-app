import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const read = (path: string) => fs.readFileSync(path, "utf8");

const RUNNER = "public/runners/offline-sync.js";
const IOS_PLUGIN = "node_modules/@capacitor/background-runner/ios/Sources/CapacitorBackgroundRunner";

function injectedCapacitorGlobals(): string[] {
  const source = read(`${IOS_PLUGIN}/Context+CapacitorAPI.swift`);
  return [...source.matchAll(/forKeyedSubscript:\s*"(Capacitor[A-Za-z]+)"/g)].map((match) => match[1]);
}

type RunnerContext = {
  listeners: Map<string, (resolve: (value: unknown) => void, reject: (error: unknown) => void, args?: unknown) => unknown>;
  kv: Map<string, string>;
};

function createRunnerContext(overrides: Record<string, unknown> = {}): RunnerContext {
  const listeners = new Map<string, (resolve: (value: unknown) => void, reject: (error: unknown) => void, args?: unknown) => unknown>();
  const kv = new Map<string, string>();
  const requests: string[] = [];

  const sandbox: Record<string, unknown> = {
    console: { log() {}, warn() {}, error() {} },
    addEventListener(event: string, callback: (resolve: unknown, reject: unknown, args?: unknown) => unknown) {
      listeners.set(event, callback as never);
    },
    setTimeout() {
      return 0;
    },
    setInterval() {
      return 0;
    },
    clearTimeout() {},
    clearInterval() {},
    async fetch(input: string) {
      requests.push(String(input));
      return { ok: true, status: 200, json: async () => ({ success: true, data: { id: "server-1" } }) };
    },
    crypto: {},
    TextEncoder,
    TextDecoder,
    CapacitorKV: {
      set(key: string, value: string) {
        kv.set(key, value);
      },
      get(key: string) {
        return kv.has(key) ? { value: kv.get(key) } : null;
      },
      remove(key: string) {
        kv.delete(key);
      },
    },
    CapacitorDevice: {
      getNetworkStatus() {
        return { connected: true, connectionType: "wifi" };
      },
      getBatteryStatus() {
        return { batteryLevel: 1, batteryState: "unplugged" };
      },
    },
    CapacitorGeolocation: {},
    CapacitorWatch: {},
    CapacitorNotifications: {},
    CapacitorApp: {},
    __requests: requests,
    ...overrides,
  };

  vm.createContext(sandbox);
  vm.runInContext(read(RUNNER), sandbox);

  return { listeners, kv };
}

function dispatch(context: RunnerContext, event: string, args?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const handler = context.listeners.get(event);
    if (!handler) {
      reject(new Error(`runner has no handler for ${event}`));
      return;
    }
    handler(resolve, reject, args);
  });
}

const queuedItem = {
  id: "item-1",
  url: "/api/v1/sync/customers",
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Acme" }),
  timestamp: 1_700_000_000_000,
  syncStatus: "pending",
  syncAttempts: 0,
};

test("the Capacitor runner only touches globals the iOS plugin actually injects", () => {
  const injected = injectedCapacitorGlobals();

  assert.ok(injected.includes("CapacitorKV"), "expected the iOS plugin to inject CapacitorKV");
  assert.ok(injected.includes("CapacitorDevice"), "expected the iOS plugin to inject CapacitorDevice");

  const referenced = new Set(read(RUNNER).match(/\bCapacitor[A-Z]\w*/g) || []);
  const unknown = [...referenced].filter((name) => !injected.includes(name));

  assert.deepEqual(
    unknown,
    [],
    `runner references Capacitor globals the iOS plugin never injects: ${unknown.join(", ")}`,
  );
});

test("native background sync drains the queued item instead of throwing", async () => {
  const context = createRunnerContext();

  await dispatch(context, "mrfStoreSyncState", {
    state: JSON.stringify({
      apiBaseUrl: "https://example.test",
      deviceToken: "device-token",
      queue: [queuedItem],
      completed: [],
      updatedAt: queuedItem.timestamp,
    }),
  });

  const result = await dispatch(context, "mrfOfflineSync");

  assert.equal(result.synced, 1);
  assert.equal(result.remaining, 0);

  const stored = JSON.parse(context.kv.get("mrf-offline-sync-state") as string);
  assert.deepEqual(stored.queue, []);
  assert.equal(stored.completed.length, 1);
  assert.equal(stored.completed[0].id, "item-1");
});

test("native background sync defers the queue when the device reports no network", async () => {
  const context = createRunnerContext({
    CapacitorDevice: {
      getNetworkStatus() {
        return { connected: false, connectionType: "none" };
      },
      getBatteryStatus() {
        return { batteryLevel: 1, batteryState: "unplugged" };
      },
    },
  });

  await dispatch(context, "mrfStoreSyncState", {
    state: JSON.stringify({
      apiBaseUrl: "https://example.test",
      deviceToken: "device-token",
      queue: [queuedItem],
      completed: [],
      updatedAt: queuedItem.timestamp,
    }),
  });

  const result = await dispatch(context, "mrfOfflineSync");

  assert.equal(result.synced, 0);
  assert.equal(result.remaining, 1);
});