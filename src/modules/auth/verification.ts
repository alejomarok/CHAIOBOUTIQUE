// Hardcoded, server-controlled — never derived from client/user input.
// Passed as `callbackURL` to auth.api.sendVerificationEmail from both the
// registration Server Action and the resend-verification Server Action, so
// Better Auth's own GET /api/auth/verify-email handler redirects here after
// verifying a token (or appends "&error=CODE" on an invalid/expired one) —
// see lib/auth-core.ts's emailVerification.sendVerificationEmail comment
// and app/(auth)/verify-email/page.tsx for how the query params are read.
export const VERIFY_EMAIL_CALLBACK_URL = "/verify-email?verified=1";
