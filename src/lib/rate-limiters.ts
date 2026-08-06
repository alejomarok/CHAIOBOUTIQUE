import "server-only";

import { createRateLimiter, type RateLimiter } from "@/lib/rate-limit";

// Keys combine normalized email + IP + action type — never a password, a
// token, or any other secret. Email is lowercased/trimmed so
// "User@Example.com" and "user@example.com " collide onto the same bucket
// (otherwise trivially bypassed). IP is included so a single attacker
// working through many emails from one address is still throttled, and so
// one email typed by many real users behind different IPs isn't
// cross-throttled by a shared address alone. `action` keeps registration,
// resend and any future action in separate namespaces.
export function buildRateLimitKey(
  action: string,
  email: string,
  ipAddress: string | null,
): string {
  const normalizedEmail = email.trim().toLowerCase();
  return `${action}:${normalizedEmail}:${ipAddress ?? "unknown"}`;
}

// In-memory (see lib/rate-limit.ts) — fine for local dev and a single
// instance, NOT safe for a multi-instance production deployment (each
// instance has its own counters). Before production, replace the
// createRateLimiter() calls below with an implementation of the same
// RateLimiter interface backed by a shared store (e.g. Upstash Redis), no
// caller-side changes needed. See SECURITY.md.
export const registrationRateLimiter: RateLimiter = createRateLimiter(5, 60 * 60 * 1000);
export const resendVerificationRateLimiter: RateLimiter = createRateLimiter(3, 10 * 60 * 1000);
// Generous enough for real add/quantity-change/remove clicking, tight
// enough to blunt a scripted add-to-cart loop — keyed per-identity (see
// modules/cart/rate-limit.ts), never per-IP alone, so one shopper's normal
// use never throttles a different shopper behind the same IP/NAT.
export const cartMutationRateLimiter: RateLimiter = createRateLimiter(30, 60 * 1000);
