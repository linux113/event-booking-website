/**
 * A small fixed-window limiter for the public write endpoints.
 *
 * Be clear about what this is: a `Map` in one Node process. Behind a load balancer,
 * or on a serverless platform, every instance counts on its own, so it raises the
 * cost of a scripted flood from one address and does no more than that. It is not
 * what keeps the database healthy — those protections are elsewhere and do not
 * depend on this file:
 *
 *   * capacity is counted from **paid** bookings, so a flood of pending rows cannot
 *     take a night off sale (`create_pending_booking`);
 *   * the same booking submitted twice collapses onto one row (`idempotency_key`);
 *   * a payment is only confirmed by a signature verified against the secret;
 *   * Supabase Auth rate-limits sign-in attempts, and the sign-in action already
 *     hands a 429 to the person typing.
 *
 * The client key is the caller's address, read from the forwarding headers the host
 * sets (Vercel, a load balancer). A deployment that terminates connections itself
 * cannot trust those headers, and there this degrades to counting per socket — one
 * reason never to rely on the limiter alone, not a reason to skip it.
 *
 * The scanner is deliberately not limited: a venue shares one address, and four
 * hundred legitimate scans arrive in a burst.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests still available in the current window (0 once refused). */
  remaining: number;
  /** Whole seconds until the window resets — what a `Retry-After` wants. */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Count one attempt for this key. Call it once per request, before any work. */
  check(key: string): RateLimitDecision;
  /** Open windows, i.e. tracked keys. Never above `maxKeys`. */
  readonly size: number;
  /** Drop every window. For tests; nothing in the app calls it. */
  reset(): void;
}

interface Window {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  /** Attempts allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Clock, injected so the window's edges can be tested without waiting. */
  now?: () => number;
  /** Ceiling on tracked keys — the bound that keeps a spoofed flotilla of
   *  addresses from turning the limiter itself into a memory leak. */
  maxKeys?: number;
}

export function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 5_000 }: RateLimitOptions): RateLimiter {
  const windows = new Map<string, Window>();

  const evict = (at: number) => {
    for (const [key, window] of windows) {
      if (window.resetAt <= at) {
        windows.delete(key);
      }
    }

    // Still full of live windows: the oldest are the least likely to be asked about
    // again soon, and dropping one only ever forgives an over-limit caller.
    while (windows.size >= maxKeys) {
      const oldest = windows.keys().next();

      if (oldest.done) {
        break;
      }

      windows.delete(oldest.value);
    }
  };

  return {
    check(key: string): RateLimitDecision {
      const at = now();
      const existing = windows.get(key);

      if (!existing || existing.resetAt <= at) {
        if (windows.size >= maxKeys) {
          evict(at);
        }

        windows.set(key, { count: 1, resetAt: at + windowMs });

        return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
      }

      existing.count += 1;

      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - at) / 1000));

      if (existing.count > limit) {
        return { allowed: false, remaining: 0, retryAfterSeconds };
      }

      return { allowed: true, remaining: limit - existing.count, retryAfterSeconds };
    },

    get size() {
      return windows.size;
    },

    reset() {
      windows.clear();
    },
  };
}

/**
 * The caller's address, as far as the host is willing to say.
 *
 * `x-forwarded-for` is a list — the client is the first entry, but a client can also
 * write that header itself, which is why the value is only ever used as a bucket
 * name and never as an identity. Anything longer than a header should be is
 * truncated rather than stored.
 */
export function clientKeyFrom(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const direct = headers.get("x-real-ip")?.trim();
  const key = forwarded || direct || "unknown";

  return key.slice(0, 64);
}

/**
 * Booking attempts — the booking endpoint and the order endpoint that creates the
 * pending booking behind the payment screen. Thirty in ten minutes is far more than
 * any one person books in a night, including a group filling in four devices, and
 * far less than a script wants.
 */
const WINDOW_MS = 10 * 60 * 1000;

export const bookingLimiter = createRateLimiter({ limit: 30, windowMs: WINDOW_MS });
export const paymentOrderLimiter = createRateLimiter({ limit: 30, windowMs: WINDOW_MS });
