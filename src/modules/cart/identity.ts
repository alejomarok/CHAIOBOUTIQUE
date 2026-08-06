import "server-only";

import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";

import { env } from "@/lib/env";
import { getCurrentUser } from "@/modules/auth";

// The cart identity model — see modules/cart/service.ts for the full
// design writeup. Exactly one of two shapes:
//   - a genuine CUSTOMER-role account's persistent, userId-keyed cart;
//   - an anonymous, cookie-token-keyed cart (guests AND staff/admin
//     sessions browsing the storefront — see the "user" branch below).
export type CartIdentity =
  | { type: "user"; userId: string }
  | { type: "anonymous"; token: string | null };

const CART_COOKIE_NAME = "chaio_cart_token";
// Matches ANONYMOUS_CART_TTL_DAYS in modules/cart/service.ts — the cookie
// and the DB row's expiresAt are set from the same constant so neither
// outlives the other.
export const ANONYMOUS_CART_TTL_DAYS = 30;
const CART_COOKIE_MAX_AGE_SECONDS = ANONYMOUS_CART_TTL_DAYS * 24 * 60 * 60;

function generateAnonymousToken(): string {
  // 256 bits of randomness — cryptographically opaque, and deliberately a
  // separate value from Cart.id (a cuid()). Never sequential, never reused,
  // never derived from anything guessable. This is the ONLY thing the
  // cookie carries; it is never itself a database primary key.
  return randomBytes(32).toString("base64url");
}

// Resolves who a cart belongs to WITHOUT ever writing a cookie — the only
// form safe to call from a Server Component render (Next.js throws if you
// call cookies().set() there). Used by read paths (header badge, cart page
// initial load): if no anonymous cookie exists yet, `token` is null and the
// caller must treat that as "no cart exists yet," never create one.
//
// A staff/admin session (authenticated but without the CUSTOMER role)
// deliberately falls through to the anonymous branch — see the module-level
// comment on CartIdentity. This is what keeps an ADMIN browsing the
// storefront from ever acquiring a customer checkout identity.
export async function resolveCartIdentityReadOnly(): Promise<CartIdentity> {
  const user = await getCurrentUser();
  if (user && user.roles.includes("CUSTOMER")) {
    return { type: "user", userId: user.id };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(CART_COOKIE_NAME)?.value ?? null;
  return { type: "anonymous", token };
}

// Resolves identity AND issues a fresh anonymous token/cookie if none exists
// yet (or the existing one no longer names a usable cart — see
// getOrCreateCart's expiry handling). Server-Action-only: cookie writes are
// only valid there (or in a Route Handler), never in a Server Component.
export async function resolveCartIdentityForMutation(): Promise<CartIdentity> {
  const user = await getCurrentUser();
  if (user && user.roles.includes("CUSTOMER")) {
    return { type: "user", userId: user.id };
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(CART_COOKIE_NAME)?.value ?? null;
  return { type: "anonymous", token };
}

// Issues a brand-new anonymous token and sets the cookie — called by
// getOrCreateCart the first time an anonymous visitor's existing token (if
// any) doesn't name a usable cart. Returns the new token so the caller can
// use it immediately without a second cookie round-trip.
export async function issueAnonymousCartCookie(): Promise<string> {
  const token = generateAnonymousToken();
  const cookieStore = await cookies();
  cookieStore.set(CART_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    // Secure in production only — mirrors lib/auth-core.ts's
    // `useSecureCookies: env.NODE_ENV === "production"` exactly, so a plain
    // http://localhost dev/e2e session (which never terminates TLS) can
    // still read the cookie back.
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE_SECONDS,
  });
  return token;
}

// Called once an anonymous cart has been merged into a customer cart (or
// explicitly cleared) — the merged cart must "no longer remain
// independently usable" per the merge policy, and a stale cookie pointing
// at it is exactly what would let it stay usable.
export async function clearAnonymousCartCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(CART_COOKIE_NAME);
}

// Reads the raw cookie value with no regard for the current session's
// role — deliberately bypassing the "CUSTOMER sessions use userId" branch
// the two functions above apply. Used exactly once, by
// mergeAnonymousCartIntoCustomerCart: at the moment merge runs, the visitor
// IS already a signed-in CUSTOMER (so resolveCartIdentityReadOnly would
// only ever report `{ type: "user" }` and never surface the leftover
// anonymous cookie from their pre-login browsing) — merge needs the raw
// token specifically to find the cart being merged FROM.
export async function peekAnonymousCartToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(CART_COOKIE_NAME)?.value ?? null;
}
