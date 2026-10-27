import "server-only";
import { env } from "@/lib/env-core";
import { createDatabaseRateLimiter } from "@/lib/database-rate-limit";

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

export interface RateLimiter {
  check(key: string): Promise<RateLimitResult>;
}

// Local/test fallback only. Production uses atomic Postgres counters shared by all instances.
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
  return env.NODE_ENV === "production"
    ? createDatabaseRateLimiter(limit, windowMs)
    : new InMemoryRateLimiter(limit, windowMs);
}
