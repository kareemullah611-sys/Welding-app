type TimingMeta = Record<string, string | number | boolean | null | undefined>;

function nowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function roundMs(value: number) {
  return Math.round(value * 10) / 10;
}

function safeMeta(meta: TimingMeta) {
  return Object.fromEntries(
    Object.entries(meta).filter(([, value]) => (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ))
  );
}

export function createApiTiming(label: string, meta: TimingMeta = {}) {
  const startedAt = nowMs();
  let lastMarkAt = startedAt;
  const marks: Array<Record<string, string | number | boolean | null | undefined>> = [];
  const slowMs = Number(process.env.API_TIMING_SLOW_MS || 750);
  const alwaysLog = process.env.API_TIMING_LOGS === "1";

  return {
    mark(step: string, extra: TimingMeta = {}) {
      const current = nowMs();
      marks.push({
        step,
        stepMs: roundMs(current - lastMarkAt),
        totalMs: roundMs(current - startedAt),
        ...safeMeta(extra),
      });
      lastMarkAt = current;
    },
    end(status: "ok" | "error" = "ok", extra: TimingMeta = {}) {
      const totalMs = roundMs(nowMs() - startedAt);
      if (!alwaysLog && totalMs < slowMs) return;
      console.info("[api-timing]", JSON.stringify({
        label,
        status,
        totalMs,
        meta: safeMeta(meta),
        marks,
        ...safeMeta(extra),
      }));
    },
  };
}
