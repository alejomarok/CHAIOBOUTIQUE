# Security

This document explains security decisions made in the foundation phase and honestly lists known
gaps that must be closed before production.

## Authentication

- Better Auth manages password hashing (scrypt) — the application never implements its own
  hashing and never touches a raw password hash.
- Sessions are database-backed, httpOnly cookies, `secure` in production
  (`advanced.useSecureCookies` in `src/lib/auth.ts`), `sameSite` per Better Auth defaults.
- Password reset uses Better Auth's token flow; the request endpoint gives a **generic response**
  regardless of whether the email exists (`ForgotPasswordForm` always shows "if that account
  exists, we sent instructions") — this prevents account enumeration.
- If the configured email transport (Mailpit in dev) is unreachable, password recovery fails
  **closed** with a clear error, rather than silently succeeding or leaking whether the account
  exists.
- Disabled/soft-deleted accounts are rejected in `getCurrentUser()` even with a technically valid
  session row — see [ARCHITECTURE.md](./ARCHITECTURE.md#authentication).
- Sessions are explicitly revoked (all `Session` rows for the user deleted) on: disabling a user,
  soft-deleting a user, completing a password reset (`revokeSessionsOnPasswordReset: true`),
  changing password from the profile page (`revokeOtherSessions: true`), and an explicit admin
  "revoke sessions" action.

## Authorization

- Every protected page/action is gated **server-side** by `requireUser()`/`requirePermission()`
  (`src/modules/auth/require-permission.ts`), which throw Next's `unauthorized()`/`forbidden()`
  — real 401/403 HTTP responses, not just a hidden menu item.
  `tests/e2e/login.spec.ts` explicitly asserts this (a restricted-role user gets HTTP 403 when
  navigating directly to an admin URL).
- `proxy.ts` is a coarse, cookie-presence-only redirect and is never treated as the actual
  authorization boundary — see [ARCHITECTURE.md](./ARCHITECTURE.md#authorization).
- Every Server Action re-validates its own inputs with Zod and re-checks the caller's permission
  independently of whatever the page that rendered the form already checked — a Server Action is
  reachable directly, not only through its originating page.

## Input validation

- All Server Action / Route Handler inputs are validated with an explicit Zod schema before
  touching Prisma. No field is ever mass-assigned from a raw request body.
- The server never trusts client-submitted role/permission ids for authorization decisions — the
  actor's permission set is always re-derived server-side from their session, not from anything
  the client sent.

## Secrets

- `BETTER_AUTH_SECRET`, `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_SERVICE_ROLE_KEY` exist only in
  server-side environment variables, never referenced from a Client Component.
- `src/lib/env.ts` validates the environment with Zod at boot and fails fast with a clear message
  if a required variable is missing — no silent `undefined` reaching Prisma or Better Auth.
- `src/lib/auth-client.ts` is the only auth module Client Components may import — it never
  carries a server secret.

## Logging

Never logged anywhere (console, audit log, error tracker): passwords, password reset tokens,
verification tokens, session tokens/cookies, secret URLs. `src/modules/email/index.ts` logs only
transport-level failures (e.g. "connection refused"), never the reset URL or its token.
Error boundaries (`src/app/error.tsx`) log the full error server-side but render only a generic
Spanish message to the user.

## Audit logging

`src/modules/audit` exposes only `recordAuditLog`/`listAuditLogs` — no update or delete function
is exposed, which is the practical meaning of "append-only" at this phase (true DB-level
immutability via triggers/permissions is a documented future hardening step, not yet built).
Wired into every user/role/store-settings mutation this phase. Sensitive values structurally
cannot leak into an audit row, since passwords/tokens never reach application code that calls
`recordAuditLog` — Better Auth owns them internally.

## CSRF

Better Auth handles CSRF protection for its own endpoints internally. Next.js Server Actions get
built-in origin-header verification. No additional CSRF middleware was added this phase.

## Rate limiting — known gap

`src/lib/rate-limit.ts` defines a working `RateLimiter` interface with an in-memory
implementation, unit-tested (`tests/unit/rate-limit.test.ts`), but **no route calls it yet**.
In-memory state doesn't survive a restart and isn't shared across multiple serverless instances,
so it is not production-safe as-is. Before production: implement `RateLimiter` against a shared
store (e.g. Upstash Redis) and apply it to `/login`, `/forgot-password`, and `/api/auth/*`.

## Dependency advisories — known, tracked

`npm audit` currently flags moderate/high advisories in `postcss`/`sharp` versions **bundled
inside `next@16.2.11` itself** (not a top-level dependency choice made here) and, transitively,
in `@better-auth/cli`'s own bundled Next.js copy (a dev-only CLI tool, not shipped to
production). These are upstream framework/tooling issues, not application code; resolving them
means waiting for a Next.js patch release, not downgrading the framework. Re-run `npm audit
--omit=dev` after any dependency update to confirm current status before shipping.

## Not yet implemented (out of scope this phase, tracked for later)

- Google OAuth / passkeys (Better Auth is architecturally ready — see
  [ARCHITECTURE.md](./ARCHITECTURE.md)).
- Email verification enforcement (`requireEmailVerification: false` until a production email
  provider exists).
- Real fiscal/payment/shipping credential handling — those integrations are documented
  interfaces only, see [INTEGRATIONS.md](./INTEGRATIONS.md).
