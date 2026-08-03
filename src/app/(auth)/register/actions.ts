"use server";

import { headers } from "next/headers";
import type { z } from "zod";

import { auth } from "@/lib/auth";
import { registrationRateLimiter, buildRateLimitKey } from "@/lib/rate-limiters";
import { VERIFY_EMAIL_CALLBACK_URL } from "@/modules/auth/verification";
import { registerSchema } from "@/modules/auth/schemas";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@/modules/customers/legal";
import {
  completeRegistrationIntent,
  createRegistrationIntent,
  registerCustomer,
} from "@/modules/customers/service";

// z.input, not z.infer: the client sends the pre-transform shape (raw
// booleans/strings); registerSchema itself has no .transform() here, but
// this stays consistent with every other Server Action in the codebase
// callable from a Client Component. See CONTRIBUTING.md.
export async function registerCustomerAction(input: z.input<typeof registerSchema>) {
  const data = registerSchema.parse(input);

  const requestHeaders = await headers();
  const ipAddress = requestHeaders.get("x-forwarded-for");

  // 1. Rate limit before any account is created — keyed by normalized email
  // + IP + action, never a secret. RegisterForm shows the same generic
  // failure toast for this as for any other registration error, so this
  // never confirms/denies anything about the email itself. See
  // lib/rate-limiters.ts.
  const rateLimitResult = await registrationRateLimiter.check(
    buildRateLimitKey("register", data.email, ipAddress),
  );
  if (!rateLimitResult.success) {
    throw new Error("Demasiados intentos de registro. Intentá de nuevo más tarde.");
  }

  // 2. Create the Better Auth user. Only name/email/password ever reach
  // this call — termsAccepted/privacyAccepted/marketingConsent are never
  // forwarded to Better Auth's own user-creation payload, and Better Auth
  // has no "role" concept to begin with. See
  // docs/adr/0003-customer-registration.md.
  const result = await auth.api.signUpEmail({
    body: { name: data.name, email: data.email, password: data.password },
  });

  // 3. Durable registration marker, written as close to step 2 as possible
  // — see modules/customers/service.ts's documented crash-window reasoning.
  await createRegistrationIntent(result.user.id);

  // 4-6. CustomerProfile + CUSTOMER role + the initial consent ledger rows
  // + audit, atomically. Legal document versions are server-controlled
  // constants (modules/customers/legal.ts) — never accepted from the
  // client.
  await registerCustomer({
    userId: result.user.id,
    marketingConsent: data.marketingConsent,
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    ipAddress: requestHeaders.get("x-forwarded-for"),
    userAgent: requestHeaders.get("user-agent"),
  });

  await completeRegistrationIntent(result.user.id);

  // 7. Sent explicitly, only now that the account is fully set up — never
  // via emailVerification.sendOnSignUp (see lib/auth-core.ts), which would
  // fire inside step 2, before CustomerProfile/CUSTOMER role/consent rows
  // exist. callbackURL is the fixed, server-controlled constant above —
  // never derived from client input.
  try {
    await auth.api.sendVerificationEmail({
      body: { email: data.email, callbackURL: VERIFY_EMAIL_CALLBACK_URL },
    });
  } catch (error) {
    // 8. Never roll back or duplicate the account on a delivery failure —
    // it stays exactly as-is: correctly configured, unverified. The
    // customer can retry from the resend-verification form.
    console.error("Verification email delivery failed after account setup.", error);
  }

  return { status: "registered" as const };
}
