# Architecture

## Shape: modular monolith

One Next.js application. No microservices in this phase — module boundaries are enforced by
folder structure and import discipline so services could be split out later if ever needed, not
by network calls today.

```
UI (Server/Client Components, forms)
  -> Server Actions / Route Handlers   (Zod validation, auth + permission check)
    -> Domain services (src/modules/<module>/service.ts)  — business rules, transactions
      -> Prisma (server-only files only) / StorageProvider / EmailProvider
        -> PostgreSQL (Supabase) / Supabase Storage / SMTP (Mailpit in dev)
```

Rules enforced, not just documented:

- Every file importing `@prisma/client`/`@/generated/prisma` or the Better Auth server instance
  imports the `server-only` package, so an accidental import from a Client Component fails the
  build rather than silently shipping secrets/DB access to the browser.
- No module reaches into another module's Prisma calls directly — cross-module needs go through
  that module's exported service functions.
- Authorization is re-checked at the actual service/action boundary even though `proxy.ts` also
  does a coarse redirect — see "Authorization" below for why the coarse check is not enough.

## Folder structure

```
prisma/
  schema.prisma
  seed.ts                      # production-safe seed only
prisma.config.ts                # Prisma 7 CLI config (migrations use DIRECT_URL)
docker-compose.yml               # local Postgres (TEST_DATABASE_URL) + Mailpit
proxy.ts                         # coarse auth gate (Next 16's middleware replacement)
src/
  app/
    (public)/                    # public site layout + homepage + catalog placeholder
    (auth)/                      # login, forgot-password, reset-password
    (admin)/admin/                # responsive sidebar shell + dashboard/users/roles/...
    (pos)/pos/                    # POS placeholder layout
    forbidden.tsx, unauthorized.tsx, not-found.tsx, error.tsx, loading.tsx
    api/auth/[...all]/route.ts    # Better Auth handler
  modules/
    auth/          # getCurrentUser, requireUser/requirePermission, session revocation
    users/         # staff user lifecycle (create/disable/enable/revoke sessions)
    roles/         # role catalog, RBAC queries/mutations, production seed logic
    permissions/   # typed permission key catalog (source of truth)
    store-settings/
    audit/         # append-only audit log service
    storage/       # StorageProvider interface + Supabase implementation + validation
    email/         # EmailProvider interface + Mailpit/SMTP implementation
  components/
    ui/            # shadcn/ui primitives
    layout/        # sidebar, header, logo, user menu
    auth/           # login/forgot-password/reset-password/change-password forms
  lib/
    auth.ts, auth-client.ts, db.ts, env.ts, utils.ts
tests/
  unit/, integration/, e2e/, fixtures/
```

## Authentication

Better Auth (`src/lib/auth.ts`), Prisma adapter, email/password, **database-backed sessions**
(not JWT). Chosen because permissions here gate financial/inventory data — a database session
is immediately revocable and always reflects current DB state, where a JWT session can carry
stale claims until it expires. This is a reversible default if the tradeoff is revisited later.

`src/lib/auth-client.ts` is the only auth-related module Client Components may import — it never
crosses server secrets to the browser.

**Disabled/soft-deleted users**: a valid Better Auth session row only proves _who_ authenticated,
not whether they're still allowed in. `getCurrentUser()` (`src/modules/auth/session.ts`)
re-checks `User.isActive`/`User.deletedAt` on every call and treats a disabled/deleted user as
unauthenticated even with a live session — this, not a UI flag, is the actual enforcement point.

**Session revocation** (disable user, soft-delete user, password reset completion, admin
"revoke sessions" action, `changePassword` with `revokeOtherSessions`): implemented as a direct
delete of that user's `Session` rows (`src/modules/auth/revoke-user-sessions.ts`). Since
sessions are plain Postgres rows the adapter manages, deleting them invalidates the session on
the next request.

## Authorization

Two layers, deliberately not equivalent:

1. **`proxy.ts`** (coarse, cheap): an optimistic session-_cookie presence_ check
   (`better-auth/cookies`'s `getSessionCookie`) on `/admin/*` and `/pos/*`, redirecting to
   `/login` if absent. This never touches the database and is not a security boundary by itself.
2. **`requireUser()` / `requirePermission()`** (`src/modules/auth/require-permission.ts`): the
   real check, called at the top of every protected layout/page/Server Action. `requireUser()`
   calls Next's `unauthorized()` (real 401, renders `app/unauthorized.tsx`) if there's no valid,
   active session; `requirePermission(key)` calls `forbidden()` (real 403, renders
   `app/forbidden.tsx`) if the resolved permission set doesn't include `key`. Both rely on
   `experimental.authInterrupts` in `next.config.ts`.

RBAC is data-driven (see [PERMISSIONS.md](./PERMISSIONS.md)): `Role` is a table, not a Prisma
enum, so new roles can be created from the admin UI without a migration; `Permission` keys are
defined once in `src/modules/permissions/catalog.ts` as a typed union, so
`requirePermission("sales.cancel")` is a compile error if the key doesn't exist, and the seed
upserts the DB from that same list — the database can never drift from what the code understands
a permission to mean.

`src/modules/roles/service.ts`'s `getUserPermissions(userId)` is the actual RBAC evaluation
(role → permission join, deduped into a `Set`), deliberately independent of Better
Auth/`next/headers` so it can be exercised directly in integration tests against a real database
rather than only through a full HTTP request — see `tests/integration/rbac.test.ts`.

## Data model boundaries (this phase)

Only auth + RBAC + store settings + audit exist. See [DATABASE.md](./DATABASE.md) for the full
schema. Deliberately no catalog/inventory/sales/payment/shipping/invoicing tables yet — each
gets its own reviewed data model (see [ROADMAP.md](./ROADMAP.md)).

## Known limitations (tracked, not hidden)

- `Role.isSystem` protects the 6 seeded roles from deletion at the **service layer only** — not
  a database constraint. Acceptable for this phase; documented as a soft-enforcement gap.
- Rate limiting (`src/lib/rate-limit.ts`, planned) has no real backing store yet — see
  [SECURITY.md](./SECURITY.md).
- `AuditLog` is "append-only" only in the sense that no update/delete function is exposed by
  `src/modules/audit` — there's no DB-level trigger/permission enforcing true immutability yet.
