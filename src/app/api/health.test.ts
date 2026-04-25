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
  } finally {
    (prisma as any).$queryRaw = originalQueryRaw;
  }
});
