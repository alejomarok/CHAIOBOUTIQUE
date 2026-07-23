# Database

PostgreSQL (hosted on Supabase) is the single source of truth for all commercial, inventory,
financial, and operational data. This document covers the foundation-phase schema, connection
strategy, and the conventions future phases must follow.

## Connection strategy

Prisma 7 requires an explicit driver adapter and no longer reads a connection URL from
`schema.prisma`'s `datasource` block. Two different URLs are used for two different purposes:

- **`DATABASE_URL`** — Supabase's **Transaction pooler** (port 6543, `?pgbouncer=true`). Used by
  the running application (`src/lib/db.ts`, via `@prisma/adapter-pg`). Safe for many short-lived
  serverless connections.
- **`DIRECT_URL`** — Supabase's **direct connection or Session pooler** (port 5432). Used only by
  the Prisma CLI (`prisma migrate dev/deploy`, `prisma db seed`), configured in
  `prisma.config.ts`. PgBouncer's transaction mode cannot run schema migrations, so migrations
  need a non-pooled (or session-pooled) connection.
- **`TEST_DATABASE_URL`** — a **separate** Postgres instance (the provided `docker-compose.yml`
  runs one on `localhost:55432`), used only by integration tests and `npm run db:test:migrate`.
  Never the same value as `DATABASE_URL`. `scripts/with-test-db.mjs` enforces this: it refuses to
  run if `TEST_DATABASE_URL` is unset, and force-overrides `DATABASE_URL`/`DIRECT_URL` to it for
  the duration of the test command — this is deliberate so a test run can never silently fall
  back to the dev/prod database.

```ts
// src/lib/db.ts
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
export const prisma = new PrismaClient({ adapter });
```

```ts
// prisma.config.ts
export default defineConfig({
  datasource: { url: env("DIRECT_URL") },
  migrations: { seed: "tsx prisma/seed.ts" },
});
```

Rationale for splitting dev vs. test onto different hosts entirely (rather than a second schema
on the same Supabase project): faster (no network round-trip), free (doesn't consume Supabase
project quota on every test run), and structurally impossible to point at by accident. A second
Supabase project/branch is an equally valid alternative if that's ever preferred — this is a
reversible default.

## Schema overview (foundation phase)

### Authentication (Better Auth)

`User`, `Session`, `Account`, `Verification` — field shapes follow Better Auth's documented
Prisma adapter schema exactly (the adapter is sensitive to field names/casing). `User` has three
extra, application-owned fields Better Auth doesn't manage: `isActive`, `disabledAt`,
`deletedAt` — see [ARCHITECTURE.md](./ARCHITECTURE.md#authentication) for how these are enforced.

### RBAC (data-driven, not a Prisma enum)

- `Role` — `key` (machine id, e.g. `ADMIN`), `name`/`description` (Spanish, user-facing),
  `isSystem` (protects the 6 seeded roles from deletion — service-layer only, see
  [ARCHITECTURE.md](./ARCHITECTURE.md#known-limitations-tracked-not-hidden)), `isActive`,
  `deletedAt` (soft delete).
- `Permission` — `key` (e.g. `products.view_cost`), upserted from the typed catalog in
  `src/modules/permissions/catalog.ts`.
- `UserRole` — join table, `userId` + `roleId` unique, `assignedAt`/`assignedBy`.
- `RolePermission` — join table, `roleId` + `permissionId` unique.

### Store configuration

`StoreConfiguration` — single row, id fixed to the literal `"main"` (a second insert collides on
the primary key instead of silently creating a second "store"). Holds name/currency/locale/
timezone. No fiscal fields — those are explicitly deferred to their own reviewed data model (see
[INTEGRATIONS.md](./INTEGRATIONS.md#electronic-invoicing-arca)).

### Audit log

`AuditLog` — `userId` (nullable, for system actions), `action`, `entityType`/`entityId`,
`previousValue`/`newValue` (JSON), `ipAddress`, `userAgent`, `correlationId`, `metadata`,
`createdAt`. Insert-only by application convention (`src/modules/audit`) — see
[SECURITY.md](./SECURITY.md#audit-logging) for what must never be written here.

## Monetary values (decided now, applies starting Phase 1)

No monetary columns exist in this phase's schema. The decided strategy for when they do:
**integer minor units** (e.g. ARS centavos as `Int`/`BigInt`), never JavaScript floats. This
matches how Mercado Pago's own API represents amounts, avoids floating-point rounding entirely,
and keeps arithmetic as plain integer math. Every future price/cost/cash-register/expense column
must follow this convention — noted here so Phase 1 (catalog/pricing) starts from a documented
decision rather than re-litigating it.

## Timestamps and timezone

All `DateTime` columns are stored in UTC (Prisma's default mapping to Postgres `timestamptz`, no
manual timezone handling at the storage layer). Display formatting converts to the store's
configured timezone (`StoreConfiguration.timezone`, initially `America/Argentina/Cordoba`) at the
UI layer using `date-fns-tz` — never stored pre-converted.

## Migrations

```bash
npx prisma migrate dev           # dev, against DATABASE_URL/DIRECT_URL
npx prisma migrate deploy        # CI/production
npm run db:test:migrate          # against TEST_DATABASE_URL only
```

Prisma 7 no longer runs `prisma generate` automatically after `migrate dev`/`db push` — run
`npm run prisma:generate` explicitly after schema changes.

## Seed strategy

`prisma/seed.ts` (idempotent, upsert-based; run with `npm run prisma:seed`) creates **only**:

1. The 6 system roles (`isSystem: true`).
2. The full permission catalog from `src/modules/permissions/catalog.ts`.
3. Role → permission assignments (additive only — a re-seed never removes a permission an admin
   granted manually afterward; it only ensures the catalog's defaults exist).
4. The base `StoreConfiguration` row.
5. **One** initial administrator — only if `INITIAL_ADMIN_NAME`/`INITIAL_ADMIN_EMAIL`/
   `INITIAL_ADMIN_PASSWORD` are all set, created through Better Auth's own sign-up path (so the
   password is hashed exactly as Better Auth expects). If any is missing, the seed logs a clear
   message and skips admin creation — it never invents a default password.

No demo products, customers, or test users of any kind. Those live exclusively in
`tests/fixtures/` (see `tests/fixtures/users.ts`) and `prisma/seed.ts` never imports from
`tests/`.

## Local test database

`docker-compose.yml` provides a disposable Postgres 17 container for `TEST_DATABASE_URL`
(`localhost:55432`) plus Mailpit. Start with `docker compose up -d`. This is a reversible
default — a second Supabase project/branch works equally well if preferred.
