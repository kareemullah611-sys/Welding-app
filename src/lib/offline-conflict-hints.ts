export type ConflictHint = {
  title: string;
  detail: string;
  recommended: "retry" | "resolve_form" | "discard";
};

function lc(value: unknown): string {
  return String(value || "").toLowerCase();
}

export function getOfflineConflictHint(url: string, errorText: string): ConflictHint {
  const path = lc(url);
  const err = lc(errorText);

  if (err.includes("already synced") || err.includes("duplicate") || err.includes("already exists")) {
    return {
      title: "Already applied",
      detail: "This change likely reached the server earlier. Retry once; if it still appears, discard local queue copy.",
      recommended: "discard",
    };
  }

  if (err.includes("cheque") && (err.includes("not in hand") || err.includes("already used") || err.includes("no longer available"))) {
    return {
      title: "Cheque state changed",
      detail: "Cheque availability changed on server. Open resolve form and select a valid cheque/source, then retry.",
      recommended: "resolve_form",
    };
  }

  if (path.includes("/personal-withdrawals") && err.includes("already approved")) {
    return {
      title: "Already approved",
      detail: "Approval was already processed. Retry once or discard this queued approval.",
      recommended: "discard",
    };
  }

  if (err.includes("validation") || err.includes("required") || err.includes("invalid")) {
    return {
      title: "Validation issue",
      detail: "Local data no longer matches server rules. Open resolve form, correct values, then retry.",
      recommended: "resolve_form",
    };
  }

  return {
    title: "Sync failed",
    detail: "Retry now. If it fails again, open resolve form to review values or discard this queued item.",
    recommended: "retry",
  };
}
