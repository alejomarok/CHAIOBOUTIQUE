import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { sendPasswordResetEmail } from "@/modules/email";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    // Not enforced yet: no production email provider is wired up to send
    // verification emails. Flipping this to true is a one-line change once
    // Resend (see INTEGRATIONS.md) is configured.
    requireEmailVerification: false,
    // Any session other than the one created by the new password stays
    // valid until this fires — see modules/auth/revoke-user-sessions.ts for
    // the other revocation triggers (disable, soft-delete, admin action).
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, url }) => {
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
