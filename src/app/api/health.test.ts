import assert from "node:assert/strict";
import test from "node:test";

import prisma from "@/lib/prisma";
import { GET } from "@/app/api/health/route";

test("health endpoint returns ok when database check succeeds", async () => {
  const originalQueryRaw = prisma.$queryRaw;
  (prisma as any).$queryRaw = async () => [{ ok: 1 }];

  try {
    const response = await GET();
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.db, "up");
  } finally {
    (prisma as any).$queryRaw = originalQueryRaw;
  }
});

test("health endpoint returns 503 when database check fails", async () => {
  const originalQueryRaw = prisma.$queryRaw;
  (prisma as any).$queryRaw = async () => {
    throw new Error("db unreachable");
  };

  try {
    const response = await GET();
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.ok, false);
    assert.equal(payload.db, "down");
    assert.equal(payload.error, "db unreachable");
  } finally {
    (prisma as any).$queryRaw = originalQueryRaw;
  }
});

test("health endpoint omits db error details in production", async () => {
  const originalQueryRaw = prisma.$queryRaw;
  const originalEnv = process.env.NODE_ENV;
  (prisma as any).$queryRaw = async () => {
    throw new Error("connection refused host=10.0.0.5");
  };
  process.env.NODE_ENV = "production";

  try {
    const response = await GET();
    const payload = await response.json();
    assert.equal(response.status, 503);
    assert.equal(payload.error, undefined);
  } finally {
    (prisma as any).$queryRaw = originalQueryRaw;
    process.env.NODE_ENV = originalEnv;
  }
});
