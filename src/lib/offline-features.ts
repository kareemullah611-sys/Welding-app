/**
 * Master switch for offline snapshots, IndexedDB cache, sync queue, and packaged offline auth.
 * Set NEXT_PUBLIC_OFFLINE_ENABLED=true when ready to turn offline back on.
 */
export function isOfflineFeaturesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_OFFLINE_ENABLED === "true";
}
