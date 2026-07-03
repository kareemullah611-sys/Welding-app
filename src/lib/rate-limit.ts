/**
 * Sliding-window rate limiter with in-memory store by default.
 * Set REDIS_URL for shared limits across multiple app instances.
 */

import Redis from "ioredis";

interface WindowEntry {
  count: number;
  resetAt: number; // epoch ms
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

const store = new Map<string, WindowEntry>();

let redisClient: Redis | null | undefined;

function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    redisClient = null;
    return null;
  }
  try {
    redisClient = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    redisClient.on("error", (err) => {
      console.error("Rate limit Redis error:", err.message);
    });
  } catch (err) {
    console.error("Rate limit Redis init failed:", err);
    redisClient = null;
  }
  return redisClient;
}

function redisKey(key: string): string {
  return `ratelimit:${key}`;
}

function requireRedisForProduction(): void {
  if (process.env.NODE_ENV !== "production") return;
  if (process.env.REDIS_URL?.trim()) return;
  if (process.env.ALLOW_MEMORY_RATE_LIMIT_IN_PRODUCTION === "true") return;
  throw new Error("REDIS_URL is required in production for shared rate limiting");
}

// Purge expired keys every 5 minutes so the Map doesn't grow forever
const purgeTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Array.from(store.entries())) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 5 * 60 * 1000);
purgeTimer.unref();

function memoryRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  let entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  entry.count += 1;
  const remaining = Math.max(0, limit - entry.count);
  return { allowed: entry.count <= limit, remaining, resetAt: entry.resetAt };
}

function memoryRejectIfRateLimited(key: string, limit: number, windowMs: number): RateLimitResult | null {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) return null;
  if (entry.count <= limit) return null;
  return { allowed: false, remaining: 0, resetAt: entry.resetAt };
}

async function redisRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) return memoryRateLimit(key, limit, windowMs);

  try {
    if (redis.status === "wait") await redis.connect();
    const rk = redisKey(key);
    const count = await redis.incr(rk);
    if (count === 1) await redis.pexpire(rk, windowMs);
    const ttl = await redis.pttl(rk);
    const resetAt = Date.now() + (ttl > 0 ? ttl : windowMs);
    const remaining = Math.max(0, limit - count);
    return { allowed: count <= limit, remaining, resetAt };
  } catch (err) {
    console.error("Rate limit Redis increment failed, falling back to memory:", err);
    return memoryRateLimit(key, limit, windowMs);
  }
}

async function redisRejectIfRateLimited(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult | null> {
  const redis = getRedis();
  if (!redis) return memoryRejectIfRateLimited(key, limit, windowMs);

  try {
    if (redis.status === "wait") await redis.connect();
    const rk = redisKey(key);
    const [countRaw, ttl] = await Promise.all([redis.get(rk), redis.pttl(rk)]);
    if (!countRaw) return null;
    const count = parseInt(countRaw, 10);
    if (Number.isNaN(count) || count <= limit) return null;
    const resetAt = Date.now() + (ttl > 0 ? ttl : windowMs);
    return { allowed: false, remaining: 0, resetAt };
  } catch (err) {
    console.error("Rate limit Redis read failed, falling back to memory:", err);
    return memoryRejectIfRateLimited(key, limit, windowMs);
  }
}

function rateLimitResponse(result: RateLimitResult, limit: number): Response {
  const retryAfterSec = Math.ceil((result.resetAt - Date.now()) / 1000);
  return new Response(
    JSON.stringify({
      success: false,
      error: "RATE_LIMITED",
      message: `Too many requests. Please try again in ${retryAfterSec} seconds.`,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Limit": String(limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      },
    }
  );
}

/**
 * Check and increment the rate limit counter for `key`.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  requireRedisForProduction();
  if (process.env.REDIS_URL?.trim()) {
    return redisRateLimit(key, limit, windowMs);
  }
  return memoryRateLimit(key, limit, windowMs);
}

/** Returns 429 when the bucket is already over limit (does not increment). */
export async function rejectIfRateLimited(
  key: string,
  limit: number,
  windowMs: number
): Promise<Response | null> {
  requireRedisForProduction();
  const blocked = process.env.REDIS_URL?.trim()
    ? await redisRejectIfRateLimited(key, limit, windowMs)
    : memoryRejectIfRateLimited(key, limit, windowMs);
  if (!blocked) return null;
  return rateLimitResponse(blocked, limit);
}

/**
 * Convenience helper: returns a 429 Response when the limit is exceeded,
 * or null when the request is allowed.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<Response | null> {
  const result = await rateLimit(key, limit, windowMs);
  if (!result.allowed) return rateLimitResponse(result, limit);
  return null;
}
