// Small in-memory sliding-window rate limiter. No dependencies.
//
// IMPORTANT - this is a best-effort cost/abuse guard, NOT a security boundary.
// All counters live in the memory of a single serverless instance: they are
// not shared between instances, they reset on cold starts, and a caller can
// spread requests across instances or IPs. It is here to stop a single client
// from hammering the LLM endpoint; if abuse protection ever needs to be
// reliable, add a real quota (account, WAF, or a shared store) in front.

/** What a rate-limit check reports back to the caller. */
export type RateLimitResult = { ok: boolean; retryAfterSeconds: number };

type Limit = { max: number; windowMs: number };

/** Per-client-IP budget: 15 requests / 5 minutes. */
const IP_LIMIT: Limit = { max: 15, windowMs: 5 * 60 * 1000 };
/** Per-conversation budget: 40 requests / 10 minutes. */
const SESSION_LIMIT: Limit = { max: 40, windowMs: 10 * 60 * 1000 };
/** Hard cap on tracked keys so the module cannot grow without bound. */
const MAX_TRACKED_KEYS = 10_000;

/** Timestamps (ms) of allowed requests, oldest first. */
const ipBuckets = new Map<string, number[]>();
const sessionBuckets = new Map<string, number[]>();

/** Drops timestamps that have fallen out of the window. */
function prune(bucket: number[], now: number, windowMs: number): number[] {
  let firstLive = 0;
  while (firstLive < bucket.length && bucket[firstLive] <= now - windowMs) firstLive++;
  return firstLive > 0 ? bucket.slice(firstLive) : bucket;
}

/** Evicts stale/old buckets when the map grows past its cap. */
function evictIfNeeded(buckets: Map<string, number[]>, now: number, windowMs: number): void {
  if (buckets.size <= MAX_TRACKED_KEYS) return;
  const target = Math.floor(MAX_TRACKED_KEYS * 0.9);
  for (const [key, bucket] of buckets) {
    if (bucket.length === 0 || bucket[bucket.length - 1] <= now - windowMs) buckets.delete(key);
    if (buckets.size <= target) return;
  }
  // Still too large: drop the oldest keys (Map keeps insertion order).
  for (const key of buckets.keys()) {
    buckets.delete(key);
    if (buckets.size <= target) return;
  }
}

/** Records one request against a bucket and reports whether it is allowed. */
function hit(buckets: Map<string, number[]>, key: string, limit: Limit, now: number): RateLimitResult {
  if (!key) return { ok: true, retryAfterSeconds: 0 };
  const bucket = prune(buckets.get(key) ?? [], now, limit.windowMs);
  if (bucket.length >= limit.max) {
    buckets.set(key, bucket);
    const retryAfterMs = bucket[0] + limit.windowMs - now;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
  }
  bucket.push(now);
  buckets.set(key, bucket);
  evictIfNeeded(buckets, now, limit.windowMs);
  return { ok: true, retryAfterSeconds: 0 };
}

/** Normalises an address so headers cannot create arbitrarily many keys. */
function normaliseAddress(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  // Accept "1.2.3.4:5678", "[::1]:5678" and bare addresses.
  const withoutPort = trimmed.startsWith("[")
    ? trimmed.slice(1, trimmed.indexOf("]") > 0 ? trimmed.indexOf("]") : undefined)
    : trimmed.replace(/:\d+$/, "");
  return withoutPort.slice(0, 64);
}

/**
 * Best-effort client IP: first hop of x-forwarded-for, then x-real-ip.
 * Only trustworthy when the app sits behind a proxy that overwrites those
 * headers (Vercel does); on a bare self-hosted Node server a client can spoof
 * them, which is another reason this limiter is not a security boundary.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = normaliseAddress(forwarded.split(",")[0] ?? "");
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    const first = normaliseAddress(realIp);
    if (first) return first;
  }
  return "unknown";
}

/**
 * Consumes one request against the IP and (when supplied) session budgets.
 * Returns the first limit that would be exceeded.
 */
export function checkRateLimit(input: { ip?: string | null; sessionId?: string | null }): RateLimitResult {
  const now = Date.now();
  const ip = input.ip ? input.ip.trim() : "";
  const sessionId = input.sessionId ? input.sessionId.trim() : "";

  const ipResult = hit(ipBuckets, ip ? "ip:" + ip : "", IP_LIMIT, now);
  if (!ipResult.ok) return ipResult;

  const sessionResult = hit(sessionBuckets, sessionId ? "sid:" + sessionId : "", SESSION_LIMIT, now);
  if (!sessionResult.ok) return sessionResult;

  return { ok: true, retryAfterSeconds: 0 };
}
