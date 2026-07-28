# Contributing

## Local workflow

```bash
npm install
cp .env.example .env   # fill in real values, see DATABASE.md
npx prisma generate
npx prisma migrate dev
npm run prisma:seed
npm run dev
```

Optional, for integration tests / password-reset testing:

```bash
docker compose up -d          # local Postgres (TEST_DATABASE_URL) + Mailpit
npm run db:test:migrate
```

## Before opening a PR

Run all of these and fix anything they report — none of them are optional:

```bash
npm run lint
npm run typecheck
npm run test              # unit
npm run test:integration  # if you touched anything DB-related
npm run build
```

## Module boundaries

- Never import `@prisma/client`/`@/generated/prisma` or `@/lib/auth` from a Client Component.
  Every file that does is marked with `import "server-only"` at the top — this turns an
  accidental client-side import into a build failure, not a runtime leak.
- Put business logic in `src/modules/<module>/service.ts` (or similar), not in a page, layout, or
  Server Action. Pages/actions should read as: validate input → check permission → call a
  service function → maybe revalidate a path.
- A module's Prisma models are only queried from that module's own files. If module B needs data
  module A owns, call module A's exported service function — don't reach into its tables
  directly.
- Every protected Server Action/page calls `requirePermission()`/`requireUser()`
  (`src/modules/auth`) itself, even if the page that renders it already checked — Server Actions
  are independently reachable.

## Adding a new permission

1. Add the key to `PERMISSIONS` in `src/modules/permissions/catalog.ts` (and its Spanish label in
   `PERMISSION_LABELS_ES`).
2. Add it to whichever role(s) should have it, in `src/modules/roles/catalog.ts`.
3. Update the matrix in [PERMISSIONS.md](./PERMISSIONS.md).
4. Re-run `npm run prisma:seed` (or let the next deploy's seed step do it) — the seed is
   additive, so existing role customizations made through the admin UI aren't touched.

## Database changes

1. Edit `prisma/schema.prisma`.
2. `npx prisma migrate dev --name <description>`.
3. `npm run prisma:generate` if it wasn't run automatically.
4. If the change affects RBAC/store-settings/audit/catalog/inventory, update the relevant section
   of [DATABASE.md](./DATABASE.md).

If the change needs a **partial unique index** (a "only one X per Y, but only when Z is null"
constraint — see the `ProductVariant`/`Warehouse`/`ProductImage` examples in
[DATABASE.md](./DATABASE.md#partial-indexes--hand-written-migration-sql-not-prismas-preview-feature))
or touches an **append-only** table, use `prisma migrate dev --create-only` and hand-edit the
generated SQL before applying it — don't reach for Prisma's `partialIndexes` preview feature (see
that same section for why).

## Adding a new import type

The migration-import pipeline (`src/modules/imports/`) is generic — extending it to a new entity
type (or a specific legacy system's column mapping) follows one pattern:

1. Add the row shape to `IMPORT_ROW_SCHEMAS`/`IMPORT_TEMPLATE_HEADERS` in
   `modules/imports/row-schemas.ts` (a Zod schema, string-in/typed-out — money fields go through
   `displayToMinorUnits`, never a raw `Number()`).
2. Add a `dedupeKey` case in `modules/imports/validate.ts` for the within-file duplicate check.
3. Add a `processXRow(tx, row, batch, actorId)` function in `modules/imports/row-processors.ts` —
   it receives an already-open transaction (never opens its own; see
   [ADR-2](./docs/adr/0002-inventory-balance-projection.md)'s "no nested transactions" rule) and
   throws `ImportRowError` for a business-rule failure (row gets recorded as a non-fatal
   `ImportIssue`, not a batch failure).
4. Wire the new case into `processRow`'s switch in `modules/imports/service.ts`.
5. Add an example row to `EXAMPLE_ROWS` in `modules/imports/templates.ts`.
6. Add unit tests (schema validation, dedupe) and an integration test (real DB round trip,
   idempotency on re-run) — see `tests/integration/imports.test.ts` for the pattern.

## Testing expectations

- New business logic (validation, RBAC evaluation, service functions) gets a unit or integration
  test — see `tests/unit/` vs `tests/integration/` for which fits (no DB access needed → unit;
  touches Prisma → integration, against `TEST_DATABASE_URL` only, never mocked).
- Don't write a test that only asserts a mock was called — assert real behavior (see
  `tests/integration/rbac.test.ts` for the pattern: real user, real role assignment, real query).
- A new protected route should have at least one authorization test proving it rejects a user
  without the right permission (403) and an unauthenticated request (401), not just that it
  accepts an authorized one.

## Code style

- ESLint + Prettier are the source of truth for formatting — run `npm run format` before
  committing, don't hand-format.
- TypeScript strict mode is on; don't add `any` or non-null assertions (`!`) to work around a
  type error — fix the underlying type.
- Comments explain _why_, not _what_ — see the repo's existing files for the expected density
  (sparse, only where a decision isn't obvious from the code itself).
- User-facing text is Spanish; identifiers, comments, and commit messages are English.

## Commits

Small, coherent commits. Don't bundle an unrelated formatting pass into a feature commit.
