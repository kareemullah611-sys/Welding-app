"use client";

import React, { useState, useEffect } from "react";
import { useOffline } from "@/hooks/useOffline";

export default function OfflineBanner() {
  const { offlineEnabled, isOnline, queueCount, syncQueue, isSyncing, lastSyncResult } = useOffline();
  const [showResult, setShowResult] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Show sync result briefly
  useEffect(() => {
    if (lastSyncResult) {
      setShowResult(true);
      const timer = setTimeout(() => setShowResult(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [lastSyncResult]);

  // Reset dismissed state when going offline
  useEffect(() => {
    if (!isOnline) setDismissed(false);
  }, [isOnline]);

  if (!offlineEnabled) return null;
  // Nothing to show
  if (isOnline && queueCount === 0 && !showResult) return null;
  if (dismissed && isOnline && queueCount === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 max-w-sm">
      {/* Offline banner */}
      {!isOnline && (
        <div className="bg-orange-600 text-white rounded-xl shadow-lg px-4 py-3 mb-2 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-orange-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728M12 12h.01" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-medium text-sm">Server unavailable</p>
            <p className="text-xs text-orange-200">Working from local data — changes sync when the server is back</p>
          </div>
        </div>
      )}

      {/* Queued items banner */}
      {queueCount > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 mb-2">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-bold text-blue-600">{queueCount}</span>
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900">
                {queueCount} pending change{queueCount !== 1 ? "s" : ""}
              </p>
              <p className="text-xs text-gray-500">
                {isOnline ? "Ready to sync" : "Will sync when server is reachable"}
              </p>
            </div>
            {isOnline && (
              <button
                onClick={syncQueue}
                disabled={isSyncing}
                className="text-xs font-medium text-primary-600 hover:text-primary-700 flex-shrink-0"
              >
                {isSyncing ? (
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Syncing...
                  </span>
                ) : (
                  "Sync now"
                )}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Sync result toast */}
      {showResult && lastSyncResult && (
        <div
          className={`rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 ${
            lastSyncResult.failed === 0
              ? "bg-green-600 text-white"
              : "bg-yellow-600 text-white"
          }`}
        >
          <span className="text-base">
            {lastSyncResult.failed === 0 ? "✓" : "⚠️"}
          </span>
          <div className="flex-1">
            <p className="text-sm font-medium">
              {lastSyncResult.synced} change{lastSyncResult.synced !== 1 ? "s" : ""} synced
              {lastSyncResult.failed > 0 && `, ${lastSyncResult.failed} failed`}
            </p>
          </div>
          <button onClick={() => setShowResult(false)} className="text-white/80 hover:text-white text-sm">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
