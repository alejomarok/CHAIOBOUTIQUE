// Pure — no "server-only", no DB import. Node's `crypto` module is safe in
// any Node context (Playwright's test-runner process included), same
// posture as modules/cart/identity.ts's generateAnonymousToken.

import { createHash, randomBytes } from "node:crypto";

// A fresh, high-entropy bearer token for the /order/[token] confirmation
// route — 256 bits (crypto.randomBytes(32)), same entropy as
// Cart.anonymousToken. Returned to the caller exactly ONCE, at Order
// creation; only its hash is ever persisted — see hashOrderAccessToken and
// Order.accessTokenHash's own schema comment.
export function generateOrderAccessToken(): string {
  return randomBytes(32).toString("base64url");
}

// SHA-256 — deliberately a fast, unsalted hash, not a slow password hash
// (bcrypt/argon2/scrypt): the token already carries 256 real bits of
// entropy (unlike a human-memorable password), so brute-forcing it is
// computationally infeasible regardless of hash speed, and a slow hash
// would only add needless latency to every confirmation-page view. This is
// a deliberate step beyond this codebase's existing precedent (Cart.
// anonymousToken is stored in plaintext, matched via a plain unique-index
// lookup) — taken here specifically because an Order's token is a
// longer-lived, more sensitive bearer credential (it can reach an email/URL
// a browser history retains), per this phase's explicit "should preferably
// be stored hashed" requirement.
export function hashOrderAccessToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}
