// @vitest-environment node
import "./guard";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { describe, expect, it } from "vitest";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { createTestUser, deleteTestUser } from "../fixtures/users";

// Both tests here go through auth.handler() — a real Request object routed
// through Better Auth's actual HTTP-level router, the same code path
// src/app/api/auth/[...all]/route.ts uses — because both rate limiting
// (src/lib/auth.ts's `rateLimit.customRules`) and the GET /verify-email
// origin/callbackURL check only run at that router layer (see
// better-auth/dist/api/index.mjs's `router().onRequest`), never for a
// programmatic auth.api.X() call made without a `request`. Every other
// integration test in this suite calls auth.api.X() directly and never
// touches this in-memory rate-limit state, so isolating both checks in this
// one file avoids any cross-file interference from the shared module-level
// counter.
describe("Better Auth router-level protections (real DB)", () => {
  it("rate limits repeated /sign-in/email attempts (src/lib/auth.ts's rateLimit.customRules)", async () => {
    const user = await createTestUser({
      name: "Rate Limit Test",
      email: `ratelimit-login-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });

    try {
      const url = `${env.BETTER_AUTH_URL}/api/auth/sign-in/email`;
      const attempt = () =>
        auth.handler(
          new Request(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            // Deliberately the wrong password: this only exercises the
            // rate limiter, never a real successful sign-in/session.
            body: JSON.stringify({ email: user.email, password: "wrong-password-123" }),
          }),
        );

      let sawRateLimited = false;
      for (let i = 0; i < 15; i++) {
        const response = await attempt();
        if (response.status === 429) {
          sawRateLimited = true;
          break;
        }
      }
      expect(sawRateLimited).toBe(true);
    } finally {
      await deleteTestUser(user.id);
    }
  });

  // Better Auth's own create-context.mjs defaults `skipOriginCheck` to
  // `true` whenever `NODE_ENV === "test"` (see @better-auth/core's
  // `isTest()`) — a built-in test-ergonomics shortcut that would make
  // `auth` (src/lib/auth.ts) silently skip the very check these two tests
  // exist to verify. A second, minimal instance — same secret/baseURL/
  // adapter/database as the real one, but with `disableOriginCheck: false`
  // forced — exercises the real validation Better Auth performs in
  // production (where NODE_ENV isn't "test"), without weakening the actual
  // app config to do it.
  const originCheckedAuth = betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    emailAndPassword: { enabled: true },
    advanced: { disableOriginCheck: false },
  });

  it("rejects an absolute, untrusted callbackURL on GET /verify-email (disableTrustedOriginsValidation is not set)", async () => {
    const url = new URL(`${env.BETTER_AUTH_URL}/api/auth/verify-email`);
    url.searchParams.set("token", "irrelevant-for-this-check");
    url.searchParams.set("callbackURL", "https://evil.example.com/steal");

    const response = await originCheckedAuth.handler(new Request(url));

    // Rejected by Better Auth's own origin-check middleware before the
    // token is ever inspected — a FORBIDDEN response, not a redirect to the
    // attacker-supplied host.
    expect(response.status).toBe(403);
  });

  it("accepts our own fixed, relative callbackURL shape on GET /verify-email (sanity check for the test above)", async () => {
    const url = new URL(`${env.BETTER_AUTH_URL}/api/auth/verify-email`);
    url.searchParams.set("token", "not-a-real-token");
    url.searchParams.set("callbackURL", "/verify-email?verified=1");

    const response = await originCheckedAuth.handler(new Request(url));

    // Never 403 for our own relative callback — it fails later, on the
    // (invalid) token itself, which better-auth surfaces as a redirect to
    // that same callbackURL with &error=INVALID_TOKEN appended.
    expect(response.status).not.toBe(403);
  });
});
