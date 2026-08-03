// @vitest-environment node
import "./guard";

import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";

import { env } from "@/lib/env";
import { VERIFY_EMAIL_CALLBACK_URL } from "@/modules/auth/verification";
import { createTestUser, deleteTestUser } from "../fixtures/users";

// Only the email transport is mocked — Better Auth, Prisma, and the real
// test database are exercised for real, same discipline as
// customer-registration.test.ts. This lets the test capture the exact
// `verifyUrl`/token Better Auth generates (there is no DB-stored
// verification row to read instead — email verification is a signed JWT,
// see lib/auth-core.ts) without depending on Mailpit actually running.
const sendVerificationEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/modules/email", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/email")>();
  return { ...actual, sendVerificationEmail: sendVerificationEmailMock };
});

const { auth } = await import("@/lib/auth");
const { prisma } = await import("@/lib/db");

describe("email verification (real DB, mocked email transport)", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    sendVerificationEmailMock.mockClear();
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  async function registerRawUser(prefix: string) {
    const user = await createTestUser({
      name: "Verify Test",
      email: `${prefix}-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function sendAndCaptureToken(email: string) {
    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: VERIFY_EMAIL_CALLBACK_URL },
    });
    const call = sendVerificationEmailMock.mock.calls.at(-1) as
      | [{ to: string; verifyUrl: string }]
      | undefined;
    const verifyUrl = call?.[0]?.verifyUrl;
    if (!verifyUrl) throw new Error("sendVerificationEmail was not called — no token to capture");
    const token = new URL(verifyUrl).searchParams.get("token");
    if (!token) throw new Error("verifyUrl had no token query param");
    return { verifyUrl, token };
  }

  it("requests a verification email pointing at a server-controlled base URL with the fixed callback", async () => {
    const user = await registerRawUser("send");
    const { verifyUrl } = await sendAndCaptureToken(user.email);

    // BETTER_AUTH_URL (server env), never NEXT_PUBLIC_APP_URL or any
    // client-supplied host.
    expect(verifyUrl.startsWith(env.BETTER_AUTH_URL)).toBe(true);
    expect(verifyUrl).toContain(`callbackURL=${encodeURIComponent(VERIFY_EMAIL_CALLBACK_URL)}`);
  });

  it("verifies a valid token and marks the account emailVerified", async () => {
    const user = await registerRawUser("valid");
    const { token } = await sendAndCaptureToken(user.email);

    await auth.api.verifyEmail({ query: { token } });

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.emailVerified).toBe(true);
  });

  it("rejects an invalid token instead of crashing or silently verifying", async () => {
    const user = await registerRawUser("invalid");

    await expect(
      auth.api.verifyEmail({ query: { token: "not-a-real-token" } }),
    ).rejects.toThrow();

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(unchanged.emailVerified).toBe(false);
  });

  it("rejects an expired token", async () => {
    const user = await registerRawUser("expired");
    // Same shape Better Auth's own signJWT produces (HS256, { email }
    // payload, BETTER_AUTH_SECRET) — see
    // node_modules/better-auth/dist/crypto/jwt.mjs — but with an
    // already-past expiration, which the public API has no way to request.
    const expiredToken = await new SignJWT({ email: user.email.toLowerCase() })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(env.BETTER_AUTH_SECRET));

    await expect(auth.api.verifyEmail({ query: { token: expiredToken } })).rejects.toThrow();

    const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(unchanged.emailVerified).toBe(false);
  });

  it("treats an already-used (already-verified) token as a safe no-op, not an error", async () => {
    const user = await registerRawUser("reused");
    const { token } = await sendAndCaptureToken(user.email);

    await auth.api.verifyEmail({ query: { token } });
    // The same token isn't invalidated after first use (see lib/auth-core.ts
    // comment) — presenting it again must not throw and must not change
    // anything, since the account is already verified.
    await expect(auth.api.verifyEmail({ query: { token } })).resolves.toBeDefined();

    const stillVerified = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stillVerified.emailVerified).toBe(true);
  });

  it("does not reveal whether an email belongs to an account — same generic result either way", async () => {
    const unknownEmail = `unknown-${Date.now()}-${Math.random()}@test.chaioboutique.local`;

    await expect(
      auth.api.sendVerificationEmail({
        body: { email: unknownEmail, callbackURL: VERIFY_EMAIL_CALLBACK_URL },
      }),
    ).resolves.toEqual({ status: true });
    // Confirms Better Auth's own anti-enumeration branch, not just our
    // wrapper: no email is actually sent for an unknown address.
    expect(sendVerificationEmailMock).not.toHaveBeenCalled();
  });

  it("does not send a new verification email for an already-verified account, but still returns a generic success", async () => {
    const user = await registerRawUser("already-verified");
    const { token } = await sendAndCaptureToken(user.email);
    await auth.api.verifyEmail({ query: { token } });
    sendVerificationEmailMock.mockClear();

    await expect(
      auth.api.sendVerificationEmail({
        body: { email: user.email, callbackURL: VERIFY_EMAIL_CALLBACK_URL },
      }),
    ).resolves.toEqual({ status: true });
    expect(sendVerificationEmailMock).not.toHaveBeenCalled();
  });
});
