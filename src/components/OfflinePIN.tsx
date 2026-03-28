"use client";

import React, { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useOffline } from "@/hooks/useOffline";

export default function OfflinePIN() {
  const { user, loading, hasPIN, showPINSetup, setupPIN, verifyAndUnlockPIN, skipPINSetup } = useAuth();
  const { isOnline } = useOffline();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handlePinInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPin(e.target.value.replace(/\D/g, "").slice(0, 4));
    setError("");
  };

  // ── PIN Setup Modal (shown once after first login if no PIN is set) ──
  if (showPINSetup) {
    return (
      <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl">
          <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-center mb-1">Set Offline PIN</h2>
          <p className="text-sm text-gray-500 text-center mb-4">
            Set a 4-digit PIN to access the app when you have no internet connection.
          </p>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={handlePinInput}
            placeholder="Enter 4-digit PIN"
            className="input-field w-full mb-3 text-center text-xl tracking-widest"
            autoFocus
          />
          {error && <p className="text-red-500 text-sm mb-3 text-center">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                if (pin.length !== 4) { setError("PIN must be exactly 4 digits"); return; }
                setSubmitting(true);
                await setupPIN(pin);
                setSubmitting(false);
                setPin("");
              }}
              disabled={submitting}
              className="btn-primary flex-1"
            >
              {submitting ? "Saving…" : "Save PIN"}
            </button>
            <button
              type="button"
              onClick={async () => { await skipPINSetup(); setPin(""); }}
              className="btn-secondary flex-1"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── PIN Unlock Screen (shown when offline and session expired/cleared) ──
  if (!isOnline && !user && !loading && hasPIN) {
    return (
      <div className="fixed inset-0 z-50 bg-gray-900 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl p-6 w-full max-w-sm shadow-xl text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728M5.636 5.636a9 9 0 000 12.728M12 8v4m0 4h.01" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold mb-1">You&apos;re Offline</h2>
          <p className="text-sm text-gray-500 mb-4">Enter your PIN to continue working offline</p>
          <input
            type="password"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={handlePinInput}
            onKeyDown={(e) => { if (e.key === "Enter" && pin.length === 4) document.getElementById("pin-unlock-btn")?.click(); }}
            placeholder="• • • •"
            className="input-field w-full mb-3 text-center text-2xl tracking-[0.5em]"
            autoFocus
          />
          {error && <p className="text-red-500 text-sm mb-3">{error}</p>}
          <button
            id="pin-unlock-btn"
            type="button"
            onClick={async () => {
              if (pin.length !== 4) { setError("Enter your 4-digit PIN"); return; }
              setSubmitting(true);
              const ok = await verifyAndUnlockPIN(pin);
              setSubmitting(false);
              if (!ok) { setError("Incorrect PIN. Try again."); setPin(""); }
            }}
            disabled={submitting || pin.length !== 4}
            className="btn-primary w-full"
          >
            {submitting ? "Verifying…" : "Unlock"}
          </button>
          <p className="text-xs text-gray-400 mt-3">Connect to the internet to log in with your password</p>
        </div>
      </div>
    );
  }

  return null;
}
