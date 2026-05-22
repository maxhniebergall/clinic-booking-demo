import { ORPCError } from "@orpc/server";

import { o } from "../index";

/**
 * Fixed-window, in-memory rate limiter keyed by `${key}:${ip}`.
 *
 * This is intentionally simple and process-local — it suits a single-process
 * local build and is the first line of defence against anonymous abuse of the
 * public booking endpoints. In production this would be backed by Redis
 * (INCR + EXPIRE) or a shared `rate_limit` table so limits hold across
 * instances and restarts.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Bounds memory against IP-spoofing: never track more than this many buckets.
const MAX_BUCKETS = 10_000;

function prune(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size <= MAX_BUCKETS) return;
  // Still over budget after dropping expired entries — evict the soonest-to-reset.
  const sorted = [...buckets.entries()].sort(
    (a, b) => a[1].resetAt - b[1].resetAt,
  );
  for (const [key] of sorted.slice(0, buckets.size - MAX_BUCKETS)) {
    buckets.delete(key);
  }
}

export function rateLimit(opts: {
  key: string;
  limit: number;
  windowMs: number;
}) {
  return o.middleware(async ({ context, next }) => {
    const now = Date.now();
    const id = `${opts.key}:${context.ip}`;
    const bucket = buckets.get(id);

    if (!bucket || bucket.resetAt <= now) {
      prune(now);
      buckets.set(id, { count: 1, resetAt: now + opts.windowMs });
    } else if (bucket.count >= opts.limit) {
      throw new ORPCError("TOO_MANY_REQUESTS", {
        message: "Too many requests. Please slow down and try again shortly.",
      });
    } else {
      bucket.count += 1;
    }

    return next();
  });
}
