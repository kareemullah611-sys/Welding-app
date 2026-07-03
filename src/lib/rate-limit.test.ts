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

test("production requires Redis-backed rate limiting unless explicitly overridden", async () => {
  const prevRedisUrl = process.env.REDIS_URL;
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAllowMemory = process.env.ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION;
  delete process.env.REDIS_URL;
  delete process.env.ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(
      () => rateLimit(`prod:${Date.now()}`, 1, 60_000),
      /REDIS_URL is required in production/
    );
  } finally {
    if (prevRedisUrl) process.env.REDIS_URL = prevRedisUrl;
    else delete process.env.REDIS_URL;
    process.env.NODE_ENV = prevNodeEnv;
    if (prevAllowMemory) process.env.ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION = prevAllowMemory;
    else delete process.env.ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION;
  }
});
