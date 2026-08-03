import { describe, expect, it } from "vitest";

import {
  buildRateLimitKey,
  registrationRateLimiter,
  resendVerificationRateLimiter,
} from "@/lib/rate-limiters";

describe("buildRateLimitKey", () => {
  it("normalizes email casing and surrounding whitespace onto the same key", () => {
    expect(buildRateLimitKey("register", "User@Example.com", "1.2.3.4")).toBe(
      buildRateLimitKey("register", "  user@example.com  ", "1.2.3.4"),
    );
  });

  it("produces different keys for different actions on the same email/IP", () => {
    expect(buildRateLimitKey("register", "user@example.com", "1.2.3.4")).not.toBe(
      buildRateLimitKey("resend-verification", "user@example.com", "1.2.3.4"),
    );
  });

  it("produces different keys for different IPs on the same email/action", () => {
    expect(buildRateLimitKey("register", "user@example.com", "1.2.3.4")).not.toBe(
      buildRateLimitKey("register", "user@example.com", "5.6.7.8"),
    );
  });

  it("produces different keys for different emails on the same IP/action", () => {
    expect(buildRateLimitKey("register", "a@example.com", "1.2.3.4")).not.toBe(
      buildRateLimitKey("register", "b@example.com", "1.2.3.4"),
    );
  });

  it("never includes a password or token — only action, email and IP go into the key", () => {
    const key = buildRateLimitKey("register", "user@example.com", "1.2.3.4");
    expect(key).toBe("register:user@example.com:1.2.3.4");
  });

  it("falls back to a stable placeholder when IP is unavailable", () => {
    expect(buildRateLimitKey("register", "user@example.com", null)).toBe(
      "register:user@example.com:unknown",
    );
  });
});

// Both limiters are process-wide singletons — each test uses a unique key
// (via Date.now()/Math.random()) so these never interfere with each other
// or with a real registration/resend flow exercised elsewhere in the suite.
describe("registrationRateLimiter", () => {
  it("blocks registration attempts once the configured limit is exceeded", async () => {
    const key = buildRateLimitKey("register", `test-${Date.now()}-${Math.random()}@x.local`, "1.1.1.1");

    let sawBlocked = false;
    for (let i = 0; i < 10; i++) {
      const result = await registrationRateLimiter.check(key);
      if (!result.success) {
        sawBlocked = true;
        break;
      }
    }
    expect(sawBlocked).toBe(true);
  });
});

describe("resendVerificationRateLimiter", () => {
  it("blocks resend attempts once the configured limit is exceeded", async () => {
    const key = buildRateLimitKey(
      "resend-verification",
      `test-${Date.now()}-${Math.random()}@x.local`,
      "1.1.1.1",
    );

    let sawBlocked = false;
    for (let i = 0; i < 10; i++) {
      const result = await resendVerificationRateLimiter.check(key);
      if (!result.success) {
        sawBlocked = true;
        break;
      }
    }
    expect(sawBlocked).toBe(true);
  });
});
