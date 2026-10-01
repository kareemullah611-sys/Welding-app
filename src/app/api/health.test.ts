import assert from "node:assert/strict";
import test from "node:test";

import prisma from "@/lib/prisma";
import { GET } from "@/app/api/health/route";

function stubQueryRaw(impl: () => Promise<unknown>) {
  const original = prisma.$queryRaw;
  (prisma as any).$queryRaw = impl;
  return () => {
    (prisma as any).$queryRaw = original;
  };
}

test("health endpoint returns ok when database check succeeds", async () => {
  const restore = stubQueryRaw(async () => [{ ok: 1 }]);
  try {
    const response = await GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally {
    restore();
  }
});

test("health endpoint returns 503 when database check fails", async () => {
  const restore = stubQueryRaw(async () => {
    throw new Error("db unreachable");
  });
  try {
    const response = await GET();
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false });
  } finally {
    restore();
  }
});

test("health endpoint leaks no operational metadata to anonymous callers", async () => {
  const originalEnv = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "production" });
  const restore = stubQueryRaw(async () => [{ ok: 1 }]);
  try {
    const payload = (await (await GET()).json()) as Record<string, unknown>;
    for (const leaked of ["uptimeSec", "db", "latencyMs", "checkedAt", "error", "service"]) {
      assert.equal(payload[leaked], undefined, `health response must not expose ${leaked}`);
    }
  } finally {
    restore();
    if (originalEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else Object.assign(process.env, { NODE_ENV: originalEnv });
  }
});

test("health endpoint omits db error details in production", async () => {
  const originalEnv = process.env.NODE_ENV;
  Object.assign(process.env, { NODE_ENV: "production" });
  const restore = stubQueryRaw(async () => {
    throw new Error("connection refused host=10.0.0.5");
  });
  try {
    const response = await GET();
    const payload = (await response.json()) as Record<string, unknown>;
    assert.equal(response.status, 503);
    assert.equal(payload.error, undefined);
    assert.deepEqual(payload, { ok: false });
  } finally {
    restore();
    if (originalEnv === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
    else Object.assign(process.env, { NODE_ENV: originalEnv });
  }
});

test("ping endpoint stays a minimal anonymous liveness probe", async () => {
  const { GET: ping } = await import("@/app/api/ping/route");
  const response = await ping();
  assert.equal(response.status, 200);
  const payload = (await response.json()) as Record<string, unknown>;
  assert.equal(payload.ok, true);
  assert.equal(payload.live, true);
  for (const leaked of ["uptimeSec", "db", "latencyMs"]) {
    assert.equal(payload[leaked], undefined, `ping response must not expose ${leaked}`);
  }
});
