import "server-only";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

// In-memory only — resets on restart/redeploy and does NOT share state
// across multiple serverless instances. This is a working interface, not a
// production-ready limiter: no route calls it yet. Before production,
// implement RateLimiter against a shared store (e.g. Upstash Redis) and
// apply it to the auth endpoints (login, forgot-password) — see SECURITY.md.
class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  async check(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.hits.get(key);

    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return { success: true, remaining: this.limit - 1, resetAt: now + this.windowMs };
    }

    if (entry.count >= this.limit) {
      return { success: false, remaining: 0, resetAt: entry.resetAt };
    }

    entry.count += 1;
    return { success: true, remaining: this.limit - entry.count, resetAt: entry.resetAt };
  }
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  return new InMemoryRateLimiter(limit, windowMs);
}
