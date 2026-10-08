import { getOfflineDeviceToken, getPackagedApiBaseUrl, isCapacitorRuntime } from "@/lib/packaged-api";

const RUNNER_LABEL = "com.mrf.kandahar.offline.sync";

export interface NativeQueuedRequest {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  timestamp: number;
  syncStatus: string;
  syncAttempts: number;
  nextRetryAt?: number | null;
  lastError?: string | null;
}

export interface NativeSyncCompletion {
  id: string;
  data: unknown;
}

export async function mirrorQueueToNativeBackground(queue: NativeQueuedRequest[]): Promise<void> {
  if (!isCapacitorRuntime()) return;
  const deviceToken = getOfflineDeviceToken();
  const apiBaseUrl = getPackagedApiBaseUrl();
  if (!deviceToken || !apiBaseUrl) return;
  const { BackgroundRunner } = await import("@capacitor/background-runner");
  await BackgroundRunner.dispatchEvent({
    label: RUNNER_LABEL,
    event: "mrfStoreSyncState",
    details: {
      state: JSON.stringify({ apiBaseUrl, deviceToken, queue, updatedAt: Date.now() }),
    },
  });
}

export async function clearNativeBackgroundSync(): Promise<void> {
  if (!isCapacitorRuntime()) return;
  const { BackgroundRunner } = await import("@capacitor/background-runner");
  await BackgroundRunner.dispatchEvent({
    label: RUNNER_LABEL,
    event: "mrfStoreSyncState",
    details: { state: JSON.stringify({ apiBaseUrl: "", deviceToken: "", queue: [], updatedAt: Date.now() }) },
  });
}

export async function readNativeBackgroundCompletions(): Promise<NativeSyncCompletion[]> {
  if (!isCapacitorRuntime()) return [];
  const { BackgroundRunner } = await import("@capacitor/background-runner");
  const result = await BackgroundRunner.dispatchEvent<{ state?: string }>({
    label: RUNNER_LABEL,
    event: "mrfReadSyncState",
    details: {},
  });
  if (!result?.state) return [];
  try {
    const state = JSON.parse(result.state) as { completed?: NativeSyncCompletion[] };
    return Array.isArray(state.completed) ? state.completed : [];
  } catch {
    return [];
  }
}
