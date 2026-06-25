"use client";

import { QUICKFORM_POST_MESSAGE } from "@/lib/quickform-embed";

type EmbedAuthRecoveryProps = {
  onRetry?: () => void;
  retrying?: boolean;
};

export function EmbedAuthRecovery({ onRetry, retrying = false }: EmbedAuthRecoveryProps) {
  const handleRetry =
    onRetry ??
    (() => {
      if (typeof window === "undefined") return;
      if (window.self !== window.top) {
        window.parent.postMessage({ type: QUICKFORM_POST_MESSAGE.reload }, window.location.origin);
        return;
      }
      window.location.reload();
    });

  return (
    <div className="quickform-embed flex h-[100dvh] flex-col items-center justify-center gap-3 bg-[linear-gradient(168deg,rgba(255,248,239,0.99),rgba(245,233,219,0.94))] p-6 text-center">
      <p className="text-sm font-medium text-[#2f241b]">Could not open this form</p>
      <p className="max-w-xs text-xs text-[#8f7963]">
        Your dashboard session is still active. Retry loading the form or close and open it again.
      </p>
      <button type="button" onClick={handleRetry} disabled={retrying} className="glass-btn glass-btn-primary min-w-[7rem]">
        {retrying ? "Retrying…" : "Retry"}
      </button>
    </div>
  );
}
