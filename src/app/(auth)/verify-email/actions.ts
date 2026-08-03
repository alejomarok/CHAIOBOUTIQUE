"use server";

import { headers } from "next/headers";
import type { z } from "zod";

import { auth } from "@/lib/auth";
import { buildRateLimitKey, resendVerificationRateLimiter } from "@/lib/rate-limiters";
import { resendVerificationSchema } from "@/modules/auth/schemas";
import { VERIFY_EMAIL_CALLBACK_URL } from "@/modules/auth/verification";

export type ResendVerificationResult = { status: "sent" } | { status: "cooldown" };

// Always resolves to one of exactly two generic outcomes — never "no
// account with that email" / "already verified" / any other distinguishing
// detail. The rate-limit key (email + IP + action) is checked before
// calling Better Auth, so a repeated-click or unknown-email caller hits the
// same "cooldown" branch either way; a legitimate, unverified account gets
// the same "sent" response an unknown or already-verified email would.
export async function resendVerificationEmailAction(
  input: z.input<typeof resendVerificationSchema>,
): Promise<ResendVerificationResult> {
  const { email } = resendVerificationSchema.parse(input);

  const requestHeaders = await headers();
  const ipAddress = requestHeaders.get("x-forwarded-for");

  const rateLimitResult = await resendVerificationRateLimiter.check(
    buildRateLimitKey("resend-verification", email, ipAddress),
  );
  if (!rateLimitResult.success) {
    return { status: "cooldown" };
  }

  try {
    // No `headers` passed: this deliberately skips Better Auth's
    // session-aware branch (which would throw EMAIL_ALREADY_VERIFIED for a
    // verified email — a distinguishing signal) and always takes its
    // constant-time, enumeration-safe path instead. See
    // node_modules/better-auth's /send-verification-email handler.
    await auth.api.sendVerificationEmail({
      body: { email, callbackURL: VERIFY_EMAIL_CALLBACK_URL },
    });
  } catch (error) {
    // Never let a delivery/lookup failure leak through as a different
    // response shape — log and still return the generic "sent" outcome.
    console.error("Resend verification email failed.", error);
  }

  return { status: "sent" };
}
