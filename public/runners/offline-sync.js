const STATE_KEY = "mrf-offline-sync-state";

function readState() {
  const stored = CapacitorKV.get(STATE_KEY);
  if (!stored || !stored.value) return null;
  try {
    return JSON.parse(stored.value);
  } catch {
    return null;
  }
}

function writeState(state) {
  CapacitorKV.set(STATE_KEY, JSON.stringify(state));
}

addEventListener("mrfStoreSyncState", (resolve, reject, args) => {
  try {
    const current = readState();
    const incoming = JSON.parse(String(args.state || "{}"));
    if (current && Array.isArray(current.completed)) incoming.completed = current.completed;
    writeState(incoming);
    resolve({ stored: true });
  } catch (error) {
    reject(error);
  }
});

addEventListener("mrfReadSyncState", (resolve, reject) => {
  try {
    const stored = CapacitorKV.get(STATE_KEY);
    const current = readState();
    if (current && Array.isArray(current.completed) && current.completed.length > 0) {
      writeState(Object.assign({}, current, { completed: [] }));
    }
    resolve({ state: stored && stored.value ? stored.value : "" });
  } catch (error) {
    reject(error);
  }
});

addEventListener("mrfOfflineSync", async (resolve, reject) => {
  try {
    const network = CapacitorNetwork.getStatus();
    const state = readState();
    if (!network.connected || !state || !state.apiBaseUrl || !state.deviceToken) {
      resolve({ synced: 0, remaining: state && state.queue ? state.queue.length : 0 });
      return;
    }

    const queue = Array.isArray(state.queue) ? state.queue.slice().sort((a, b) => a.timestamp - b.timestamp) : [];
    const remaining = [];
    const completed = Array.isArray(state.completed) ? state.completed.slice(-100) : [];
    let synced = 0;

    for (const item of queue) {
      if (item.nextRetryAt && item.nextRetryAt > Date.now()) {
        remaining.push(item);
        continue;
      }
      try {
        const headers = Object.assign({}, item.headers || {}, {
          "x-offline-device-token": state.deviceToken,
          "x-sync-request-id": item.id,
          "x-sync-device-id": "capacitor-background",
        });
        const response = await fetch(state.apiBaseUrl + item.url, {
          method: item.method,
          headers,
          body: item.method === "GET" ? undefined : item.body,
        });
        const data = await response.json().catch(() => null);
        if (response.ok && data && data.success) {
          synced += 1;
          completed.push({ id: item.id, data: data.data || data });
          continue;
        }
        const attempts = Number(item.syncAttempts || 0) + 1;
        remaining.push(Object.assign({}, item, {
          syncStatus: response.status === 409 ? "conflict" : "failed",
          syncAttempts: attempts,
          nextRetryAt: Date.now() + Math.min(300000, Math.pow(2, Math.min(attempts, 8)) * 5000),
          lastError: data && data.error ? String(data.error.message || data.error) : "Sync failed (" + response.status + ")",
        }));
      } catch (error) {
        const attempts = Number(item.syncAttempts || 0) + 1;
        remaining.push(Object.assign({}, item, {
          syncStatus: "failed",
          syncAttempts: attempts,
          nextRetryAt: Date.now() + Math.min(300000, Math.pow(2, Math.min(attempts, 8)) * 5000),
          lastError: "Network error",
        }));
      }
    }

    writeState(Object.assign({}, state, { queue: remaining, completed: completed.slice(-200), updatedAt: Date.now(), lastResult: { synced, remaining: remaining.length } }));
    resolve({ synced, remaining: remaining.length });
  } catch (error) {
    reject(error);
  }
});
