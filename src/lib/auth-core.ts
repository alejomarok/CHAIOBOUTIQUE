import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { prisma } from "@/lib/db-core";
import { env } from "@/lib/env-core";

// Node-safe core: no "server-only" import, and only imports other Node-safe
// core modules (db-core, env-core) so the whole construction is runnable
// from a plain Node context — prisma/seed.ts (`tsx`) needs a real Better
// Auth instance to create the initial administrator through the same
// signUpEmail path the running app uses, so the password is hashed exactly
// as Better Auth expects (never hand-rolled). See src/lib/auth.ts and
// ARCHITECTURE.md.

// Whether a newly created account must verify its email before a session
// can be created. A named export (not inlined below) so callers outside
// this config — e.g. prisma/seed.ts, deciding whether the seeded
// administrator needs emailVerified: true — read the same value the live
// config uses instead of duplicating it.
//
// Deliberately kept false: staff accounts created before Phase 3B (and any
// created directly via prisma/seed.ts, which never sends a verification
// email) must keep signing in. Unverified-CUSTOMER handling instead lives
// entirely in modules/auth/post-login-redirect.ts (redirect to
// /verify-email) and the CUSTOMER-role check there — never inferred from
// permission count, and never by locking sign-in itself. See SECURITY.md.
export const REQUIRE_EMAIL_VERIFICATION = false;

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: REQUIRE_EMAIL_VERIFICATION,
    // Any session other than the one created by the new password stays
    // valid until this fires — see modules/auth/revoke-user-sessions.ts for
    // the other revocation triggers (disable, soft-delete, admin action).
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
      // Dynamic import, deliberately: modules/email is "server-only"-guarded
      // (real SMTP I/O has no business running from a CLI script), and this
      // callback only ever executes from a live Next.js request handling an
      // actual password-reset request. Deferring the import means
      // prisma/seed.ts's static import graph never touches it, even though
      // this file constructs the same auth config the seed reuses.
      const { sendPasswordResetEmail } = await import("@/modules/email");
      await sendPasswordResetEmail({ to: user.email, resetUrl: url });
    },
  },
  emailVerification: {
    // `url` is fully built by Better Auth from `baseURL` (server config,
    // never client input) plus the token and callbackURL WE pass to
    // sendVerificationEmail (see modules/customers registration action and
    // verify-email/actions.ts) — always a hardcoded relative path like
    // "/verify-email?verified=1", never derived from a request. Clicking the
    // link hits Better Auth's own GET /api/auth/verify-email handler
    // directly, which verifies the token then redirects to that callbackURL
    // (appending ?error=CODE on failure) — no client-side token handling of
    // our own. See docs on BASE_ERROR_CODES for the exact error codes
    // (TOKEN_EXPIRED, INVALID_TOKEN, USER_NOT_FOUND) surfaced this way.
    sendVerificationEmail: async ({ user, url }) => {
      const { sendVerificationEmail } = await import("@/modules/email");
      await sendVerificationEmail({ to: user.email, verifyUrl: url });
    },
    // false: sent explicitly, after CustomerProfile/CUSTOMER-role/consent
    // rows are committed (see the registration Server Action) — never
    // racing ahead of account setup, and never sent at all for staff
    // accounts created outside public registration (e.g. via the admin
    // panel or prisma/seed.ts), which don't call sendVerificationEmail.
    sendOnSignUp: false,
    expiresIn: 60 * 60, // 1 hour
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh the expiry once per day of activity
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
  },
  // Better Auth's own endpoints only — /sign-in/email is called directly by
  // LoginForm via authClient (no app-owned Server Action wraps it, so our
  // own RateLimiter in lib/rate-limiters.ts can't reach it). Registration
  // and resend-verification DO go through app-owned Server Actions and are
  // rate-limited there instead, keyed by normalized email + IP (see
  // lib/rate-limiters.ts) rather than IP alone. `storage` stays at its
  // "memory" default: not shared across instances, documented as a
  // pre-production gap in the same place as lib/rate-limit.ts's.
  //
  // Raised (never disabled — this endpoint's rate limiting itself stays
  // exercised) only under E2E_TEST_MODE: the whole Playwright suite shares
  // one webServer process and therefore one in-memory counter, and as more
  // specs log in, real automated logins from many spec files can
  // legitimately exceed 10/60s with zero attacker involved — a false
  // positive this app's own tests would trip, not a security signal. Never
  // "true" outside a Playwright run — see env-core.ts's E2E_TEST_MODE,
  // which is only ever set by playwright.config.ts's webServer.env.
  rateLimit: {
    enabled: true,
    customRules: {
      "/sign-in/email": { window: 60, max: env.E2E_TEST_MODE ? 200 : 10 },
    },
  },
  user: {
    additionalFields: {
      // Read-only from the client's perspective: only server-side admin
      // actions (modules/users) may set these. See ARCHITECTURE.md for why
      // disabling/soft-deleting is enforced in getCurrentUser(), not here.
      isActive: { type: "boolean", input: false },
      disabledAt: { type: "date", input: false, required: false },
      deletedAt: { type: "date", input: false, required: false },
    },
  },
});
