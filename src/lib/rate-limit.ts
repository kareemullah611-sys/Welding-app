/**
 * Simple in-memory sliding-window rate limiter.
 *
 * Suitable for a single-process Next.js deployment (works fine on Vercel/Neon
 * per-instance). For multi-process / edge deployments swap the store with Redis.
 */

interface WindowEntry {
  count: number;
  resetAt: number; // epoch ms
}

const store = new Map<string, WindowEntry>();

// Purge expired keys every 5 minutes so the Map doesn't grow forever
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of Array.from(store.entries())) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * Check and increment the rate limit counter for `key`.
 *
 * @param key      Unique bucket key, e.g. `login:192.168.1.1`
 * @param limit    Max allowed hits per window
 * @param windowMs Window size in milliseconds
 * @returns `{ allowed: boolean; remaining: number; resetAt: number }`
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetAt: number } {
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

/**
 * Convenience helper: returns a 429 Response when the limit is exceeded,
 * or null when the request is allowed.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Response | null {
  const result = rateLimit(key, limit, windowMs);
  if (!result.allowed) {
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
  return null;
}
