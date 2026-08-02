import { strict as assert } from "node:assert";
import test from "node:test";
import { createApiTiming } from "./api-timing";

test("api timing emits safe structured timing log when enabled", () => {
  const previousFlag = process.env.API_TIMING_LOGS;
  const logs: unknown[] = [];
  const previousInfo = console.info;
  process.env.API_TIMING_LOGS = "1";
  console.info = (...args: unknown[]) => {
    logs.push(args);
  };

  try {
    const timing = createApiTiming("payments.POST", {
      role: "city_admin",
      cityId: 2,
      nested: { secret: "ignored" } as any,
    });
    timing.mark("parse+validate", { rows: 1 });
    timing.end("ok");
  } finally {
    console.info = previousInfo;
    if (previousFlag === undefined) delete process.env.API_TIMING_LOGS;
    else process.env.API_TIMING_LOGS = previousFlag;
  }

  assert.equal(logs.length, 1);
  const [prefix, payload] = logs[0] as [string, string];
  assert.equal(prefix, "[api-timing]");
  const parsed = JSON.parse(payload);
  assert.equal(parsed.label, "payments.POST");
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.meta.role, "city_admin");
  assert.equal(parsed.meta.cityId, 2);
  assert.equal(parsed.meta.nested, undefined);
  assert.equal(parsed.marks[0].step, "parse+validate");
  assert.equal(parsed.marks[0].rows, 1);
});
