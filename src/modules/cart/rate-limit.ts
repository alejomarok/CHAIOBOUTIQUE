import "server-only";

import { headers } from "next/headers";

import { resolveCartIdentityForMutation } from "./identity";

// Keyed by the server-resolved identity (never client input): a signed-in
// CUSTOMER is keyed by userId; an anonymous visitor is keyed by their
// existing cart cookie token plus IP (a brand-new visitor with no token yet
// falls back to IP alone for this one check — the token itself is issued
// moments later, inside the actual mutation). Read-only re-resolution: this
// never itself issues a cookie. See lib/rate-limiters.ts's
// cartMutationRateLimiter.
export async function buildCartMutationRateLimitKey(): Promise<string> {
  const identity = await resolveCartIdentityForMutation();
  if (identity.type === "user") return `cart:user:${identity.userId}`;

  const requestHeaders = await headers();
  const ipAddress = requestHeaders.get("x-forwarded-for") ?? "unknown";
  return `cart:anon:${identity.token ?? "no-token"}:${ipAddress}`;
}
