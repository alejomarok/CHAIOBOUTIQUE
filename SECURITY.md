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
- Email verification uses Better Auth's own built-in flow (`emailVerification` in
  `src/lib/auth.ts`), not a parallel token implementation. The link mailed to the customer is
  `{BETTER_AUTH_URL}/api/auth/verify-email?token=...&callbackURL=...` — `BETTER_AUTH_URL` is a
  server-side env var, never client input, and `callbackURL` is always the hardcoded constant
  `VERIFY_EMAIL_CALLBACK_URL` (`/verify-email?verified=1`, see `src/modules/auth/verification.ts`)
  passed by our own Server Actions, never anything read from a request. Clicking the link hits
  Better Auth's endpoint directly (a GET, so no client JS is required to complete verification);
  on success it redirects to the fixed callback, on an invalid/expired token it appends
  `&error=TOKEN_EXPIRED`/`&error=INVALID_TOKEN`, and an already-verified token is treated as a
  success, not an error (idempotent, no distinguishing signal). `/verify-email`
  (`src/app/(auth)/verify-email/page.tsx`) renders all three outcomes from these query params
  alone — it never receives or logs the token itself.
- `requireEmailVerification` stays `false` (see `REQUIRE_EMAIL_VERIFICATION` in
  `src/lib/auth.ts`) so pre-Phase-3B staff accounts and accounts created outside public
  registration (admin panel, `prisma/seed.ts`) keep signing in without ever having gone through
  email verification. Unverified public customers are instead redirected to `/verify-email`
  after login by `resolvePostLoginDestination` (`src/modules/auth/post-login-redirect.ts`),
  which checks the `CUSTOMER` role explicitly — **never** inferred from having zero permissions
  or from `emailVerified` alone, since a non-CUSTOMER account is never held to this policy.
- Resend verification (`resendVerificationEmailAction`,
  `src/app/(auth)/verify-email/actions.ts`) always returns one of exactly two generic outcomes
  (`sent` / `cooldown`) — it never reveals whether the submitted email belongs to an account, is
  already verified, or doesn't exist. It also never passes a session/`headers` to
  `auth.api.sendVerificationEmail`, which forces Better Auth's own constant-time,
  enumeration-safe code path (the alternative, session-aware path throws a distinguishing
  `EMAIL_ALREADY_VERIFIED` error) every time, regardless of whether the caller's browser happens
  to be logged in.

## Session security

Reviewed for Phase 3B (`src/lib/auth.ts` unless noted):

- **Cookie security**: Better Auth's session cookie is always `httpOnly` (never readable from
  client JS) and `secure` in production (`advanced.useSecureCookies: env.NODE_ENV ===
  "production"`) — plain HTTP locally, HTTPS-only once deployed.
- **SameSite**: Better Auth's default, `Lax`, is not overridden. Fine for this app: no
  cross-site flow (OAuth redirect, cross-domain embed) needs a laxer setting, and `Lax` already
  blocks the cookie being sent on a cross-site POST, the main CSRF vector for a state-changing
  request.
- **Session expiration/renewal**: `session.expiresIn` is 7 days; `session.updateAge` is 1 day —
  a session silently rolls forward on activity at most once per day, so an abandoned session
  still expires within a week of its last real use, not 7 days from every page load.
- **Trusted origins**: not explicitly configured — Better Auth derives the trusted origin set
  from `BETTER_AUTH_URL` alone (a server-side env var), so only this app's own origin is
  trusted by default; nothing wildcards additional hosts in. Every `callbackURL`/`redirectTo`
  this app ever passes to a Better Auth endpoint is a hardcoded relative path (never read from a
  request), and Better Auth additionally validates relative paths against a strict regex (no
  `//`, no backslash, no scheme) before honoring them — see `matchesOriginPattern` in
  `better-auth/dist/auth/trusted-origins.mjs`.
- **Logout invalidation**: `authClient.signOut()` (`src/components/layout/user-menu.tsx`) calls
  Better Auth's own sign-out endpoint, which deletes the session row server-side and clears the
  cookie — not just a client-side redirect.
- **Open-redirect protection**: `isSafeInternalPath()` (`src/lib/safe-redirect.ts`) gates every
  client-supplied `redirectTo` before it's ever handed to `router.push` or compared against
  `isAuthorizedForPath()`; Better Auth's own `callbackURL`/`redirectTo`/`errorCallbackURL`/
  `newUserCallbackURL` validation (`disableTrustedOriginsValidation` is **not** set, so this
  stays on) provides a second, independent check on every Better Auth endpoint that accepts one.
- **CSRF/origin validation**: `disableCSRFCheck` and `disableTrustedOriginsValidation` are both
  left at their default (`false`/enabled) — neither is disabled anywhere in this codebase.

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
is exposed. Since the catalog/inventory phase, "append-only" is also a **database-level**
guarantee, not just an application convention: a Postgres `BEFORE UPDATE OR DELETE` trigger on
`audit_log` (applied to every database role, including the application's own connection) rejects
any attempt, mirroring the same trigger on `inventory_movement` — see
[DATABASE.md](./DATABASE.md#append-only-enforcement-inventory_movement-audit_log) for the SQL and
the documented, human-only break-glass procedure for the (expected-never) exceptional case.
Wired into every user/role/store-settings/catalog/inventory mutation. Sensitive values
structurally cannot leak into an audit row, since passwords/tokens never reach application code
that calls `recordAuditLog` — Better Auth owns them internally.

**Inventory-specific exception to the after-commit pattern**: every other mutation records its
audit entry after its triggering transaction commits. Inventory operations
(`modules/inventory/service.ts`'s `applyInventoryOperation`) write the balance change, the
`InventoryOperation`/`InventoryMovement` rows, and the `AuditLog` entry inside **one**
transaction — deliberate, because a committed-but-unaudited stock change is a real operational
risk in a way most other mutations aren't. See
[ADR-2](./docs/adr/0002-inventory-balance-projection.md).

## File upload validation (product images)

`src/modules/storage/validation.ts`, called from `modules/products/product-images.ts`'s
`uploadProductImage`, layers three checks — none alone is trusted:

1. **MIME allowlist + extension cross-check** (`validateUpload`) — the declared `Content-Type`
   must be in an explicit per-caller allowlist (product images: JPEG/PNG/WebP only), and the file
   extension must match it.
2. **File-signature ("magic bytes") check** (`validateImageFileSignature`) — reads the first
   bytes of the actual uploaded buffer (JPEG `FF D8 FF`, PNG `89 50 4E 47 0D`, WebP `RIFF`…`WEBP`
   at offset 8) and rejects a mismatch between the declared `Content-Type` and what the bytes
   actually are. A browser or a crafted request can lie about `Content-Type`; it can't fake the
   file's own leading bytes without producing an invalid image.
3. **Dimension bound** (`image-size`, a pure-JS decoder — no `sharp`/native dependency this
   phase, see [INTEGRATIONS.md](./INTEGRATIONS.md)) rejects anything over 6000px per side before
   it's ever stored.

The generated storage path (`buildObjectPath`) never uses the caller-supplied filename — it's a
generated UUID under `entityType/entityId/`, which also rules out path traversal.

## CSV injection protection (imports)

Every CSV the application generates for a human to open in a spreadsheet — the import template
download and the post-import error report (`src/modules/imports/csv.ts`/`templates.ts`) — runs
every cell through `sanitizeCsvCell()`, which prefixes a value starting with `=`, `+`, `-`, or
`@` with a single quote. Excel/Sheets/LibreOffice interpret an unprefixed leading `=`/`+`/`-`/`@`
as a formula, which is the standard vector for CSV/formula injection when a generated report
later gets opened by a human; the prefix forces the cell to render as literal text instead. This
is the OWASP-documented mitigation for this class of issue — see
`tests/unit/imports-csv.test.ts` for the direct assertion.

Uploaded import CSVs, by contrast, are never opened in a spreadsheet by this application — they
go through `csv-parse` into plain string fields, validated by Zod
(`modules/imports/row-schemas.ts`) before touching the database, so injection isn't a concern on
the read side; the mitigation only matters for CSVs this application writes back out.

## CSRF

Better Auth handles CSRF protection for its own endpoints internally. Next.js Server Actions get
built-in origin-header verification. No additional CSRF middleware was added this phase.

## Rate limiting

`src/lib/rate-limit.ts` defines a `RateLimiter` interface with an in-memory implementation,
unit-tested (`tests/unit/rate-limit.test.ts`). As of Phase 3B it is wired into the three flows
Phase 3B requires protecting:

- **Registration** (`registerCustomerAction`) and **resend verification**
  (`resendVerificationEmailAction`) each use their own limiter instance
  (`src/lib/rate-limiters.ts`), keyed by `buildRateLimitKey(action, email, ipAddress)` — a
  normalized (trimmed, lowercased) email plus IP plus action name, **never** a password or
  token. Registration failing this check surfaces the same generic client-side error as any
  other registration failure; resend returns its own generic `"cooldown"` outcome (see above).
- **Login** (`/sign-in/email`) is a Better Auth-native endpoint called directly from
  `LoginForm` via `authClient`, with no app-owned Server Action in front of it — so it's rate
  limited via Better Auth's own built-in `rateLimit.customRules` (`src/lib/auth.ts`) instead of
  the app-level `RateLimiter`, at 10 attempts/60s per Better Auth's own (IP-based) key.

**Known gap, unchanged**: both mechanisms' default storage is in-memory — state doesn't survive
a restart and isn't shared across multiple serverless instances, so neither is production-safe
as-is for a multi-instance deployment. Before production: implement `RateLimiter` against a
shared store (e.g. Upstash Redis) for the app-level limiters, and switch Better Auth's
`rateLimit.storage` to `"database"` or `"secondary-storage"` for its own — no caller-side
changes needed for either, since both are already behind their respective interfaces/config.

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
- Email verification *enforcement* at sign-in (`requireEmailVerification` stays `false` — see
  "Session security" above for why). The verification flow itself (send, resend, verify) is
  implemented as of Phase 3B; only the global sign-in gate is deferred, to avoid locking out
  every pre-existing staff account.
- Real fiscal/payment/shipping credential handling — those integrations are documented
  interfaces only, see [INTEGRATIONS.md](./INTEGRATIONS.md).
