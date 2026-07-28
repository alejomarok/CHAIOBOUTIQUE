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
    categories/, brands/, attributes/  # catalog lookup entities (sizes/colors)
    products/      # products, variants, pricing/visibility rules, images, public DTOs
    warehouses/    # warehouse CRUD, single-default invariant
    inventory/     # InventoryOperation/Movement/Balance — see ADR-2
    imports/       # CSV migration-import pipeline — see DATABASE.md, ADR-2
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

Auth + RBAC + store settings + audit + catalog (categories/brands/sizes/colors/products/
variants/images) + inventory (warehouses/balances/operations/movements) + a generic CSV
migration-import pipeline exist. See [DATABASE.md](./DATABASE.md) for the full schema.
Deliberately no suppliers/purchasing/customers/sales/payments/shipping/invoicing tables yet —
each gets its own reviewed data model (see [ROADMAP.md](./ROADMAP.md)).

Catalog/inventory mutations follow the same layering as everything else (page/action → service →
Prisma), with two narrow, documented exceptions specific to inventory — see
[ADR-2](./docs/adr/0002-inventory-balance-projection.md):

- Inventory writes go through one shared transaction-aware primitive
  (`modules/inventory/service.ts`'s `applyInventoryOperation`) rather than each caller writing
  Prisma calls directly, so `adjustInventory`/`transferInventory`/the per-row import pipeline
  can't accidentally diverge on the atomic-update/idempotency/audit logic.
- Inventory audit entries are written in the **same** transaction as the balance change, not
  after commit like every other module — see "Known limitations" below and ADR-2 for why this
  one domain gets the exception.

## Known limitations (tracked, not hidden)

- `Role.isSystem` protects the 6 seeded roles from deletion at the **service layer only** — not
  a database constraint. Acceptable for this phase; documented as a soft-enforcement gap.
- Rate limiting (`src/lib/rate-limit.ts`, planned) has no real backing store yet — see
  [SECURITY.md](./SECURITY.md).
- `AuditLog` and `InventoryMovement` are append-only both by application convention (no
  update/delete function exposed) **and**, since the catalog/inventory phase, by a database-level
  `BEFORE UPDATE OR DELETE` trigger — see
  [DATABASE.md](./DATABASE.md#append-only-enforcement-inventory_movement-audit_log).
- Inventory audit entries are written inside the same transaction as their triggering state
  change, a deliberate, scoped deviation from the after-commit pattern every other module
  follows — see [ADR-2](./docs/adr/0002-inventory-balance-projection.md). Don't copy this
  pattern into a new module without the same "committed-but-unaudited state would be a real
  operational problem" justification.
- The CSV import pipeline (`modules/imports/`) processes catalog rows single-pass, in file
  order — a row referencing a parent/product that appears later in the same file fails; source
  files must list parents/products before their children/variants. See
  [DATABASE.md](./DATABASE.md#migration-import-foundation-importbatch-importissue).
