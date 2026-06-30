import assert from "node:assert/strict";
import test from "node:test";

import { rateLimit, rejectIfRateLimited } from "./rate-limit";

test("rateLimit blocks after limit in memory mode", async () => {
  const prev = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  const key = `test:${Date.now()}`;
  try {
    const first = await rateLimit(key, 2, 60_000);
    assert.equal(first.allowed, true);
    const second = await rateLimit(key, 2, 60_000);
    assert.equal(second.allowed, true);
    const third = await rateLimit(key, 2, 60_000);
    assert.equal(third.allowed, false);
  } finally {
    if (prev) process.env.REDIS_URL = prev;
  }
});

test("rejectIfRateLimited does not increment counter", async () => {
  const prev = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  const key = `reject:${Date.now()}`;
  try {
    assert.equal(await rejectIfRateLimited(key, 1, 60_000), null);
    await rateLimit(key, 1, 60_000);
    await rateLimit(key, 1, 60_000);
    const blocked = await rejectIfRateLimited(key, 1, 60_000);
    assert.ok(blocked);
    assert.equal(blocked?.status, 429);
  } finally {
    if (prev) process.env.REDIS_URL = prev;
  }
});
