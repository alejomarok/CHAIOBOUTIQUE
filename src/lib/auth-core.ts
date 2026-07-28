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
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh the expiry once per day of activity
  },
  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
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
