export type Rate = { capacity: number; refillMs: number };

/**
 * One token bucket per key. The clock is injected so the tests can exhaust and refill a bucket
 * without waiting in real time.
 *
 * This is the control that protects Piston's public instance — which allows roughly 5 requests a
 * second across all of its users — from an abusive client, and protects us from being blocked.
 * It is server-side, and the client is never trusted with it.
 */
export class TokenBuckets {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly rate: Rate,
    private readonly now: () => number = Date.now,
  ) {}

  /** Consumes a token if one is available. Returns false if the caller must wait. */
  take(key: string): boolean {
    const at = this.now();
    const bucket = this.buckets.get(key) ?? { tokens: this.rate.capacity, updatedAt: at };

    const refilled = Math.min(
      this.rate.capacity,
      bucket.tokens + (at - bucket.updatedAt) / this.rate.refillMs,
    );

    if (refilled < 1) {
      this.buckets.set(key, { tokens: refilled, updatedAt: at });
      return false;
    }

    this.buckets.set(key, { tokens: refilled - 1, updatedAt: at });
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }
}
