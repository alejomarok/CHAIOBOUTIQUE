import { createHash } from "node:crypto";
import { prisma } from "@/lib/db-core";
import type { RateLimiter, RateLimitResult } from "@/lib/rate-limit";

export function createDatabaseRateLimiter(limit: number, windowMs: number): RateLimiter {
  return {
    async check(rawKey: string): Promise<RateLimitResult> {
      const key = createHash("sha256").update(`${limit}:${windowMs}:${rawKey}`).digest("hex");
      // One atomic upsert across all instances. Keys do not expose emails or IP addresses.
      const [row] = await prisma.$queryRaw<Array<{ count: number; expiresAt: Date }>>`
        INSERT INTO app_rate_limit (key, count, "expiresAt")
        VALUES (${key}, 1, clock_timestamp() + ${windowMs} * interval '1 millisecond')
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN app_rate_limit."expiresAt" <= clock_timestamp() THEN 1 ELSE LEAST(app_rate_limit.count + 1, ${limit + 1}) END,
          "expiresAt" = CASE WHEN app_rate_limit."expiresAt" <= clock_timestamp() THEN clock_timestamp() + ${windowMs} * interval '1 millisecond' ELSE app_rate_limit."expiresAt" END
        RETURNING count, "expiresAt"
      `;
      if (!row) throw new Error("Rate limit storage unavailable");
      return {
        success: row.count <= limit,
        remaining: Math.max(0, limit - row.count),
        resetAt: row.expiresAt.getTime(),
      };
    },
  };
}
