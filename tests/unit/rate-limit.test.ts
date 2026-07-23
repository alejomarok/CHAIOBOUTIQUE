import { describe, expect, it } from "vitest";

import { createRateLimiter } from "@/lib/rate-limit";

describe("createRateLimiter (in-memory)", () => {
  it("allows requests up to the limit", async () => {
    const limiter = createRateLimiter(3, 60_000);

    expect((await limiter.check("k")).success).toBe(true);
    expect((await limiter.check("k")).success).toBe(true);
    expect((await limiter.check("k")).success).toBe(true);
  });

  it("blocks once the limit is exceeded", async () => {
    const limiter = createRateLimiter(2, 60_000);

    await limiter.check("k");
    await limiter.check("k");
    const third = await limiter.check("k");

    expect(third.success).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it("tracks separate keys independently", async () => {
    const limiter = createRateLimiter(1, 60_000);

    expect((await limiter.check("a")).success).toBe(true);
    expect((await limiter.check("b")).success).toBe(true);
    expect((await limiter.check("a")).success).toBe(false);
  });

  it("resets after the window elapses", async () => {
    const limiter = createRateLimiter(1, 10);

    expect((await limiter.check("k")).success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await limiter.check("k")).success).toBe(true);
  });
});
