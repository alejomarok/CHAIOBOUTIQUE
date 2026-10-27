# CHAIOBOUTIQUE

Women's fashion store platform: public ecommerce storefront, customer account area, internal
administration panel, and point-of-sale — one modular-monolith Next.js application backed by
PostgreSQL.

The application includes catalog, customers, inventory, sales/POS, Mercado Pago checkout,
order fulfillment, customer requests, transactional email, legal pages and manual/external
fiscal records. ARCA automatic issuance remains homologation-only.

**Production delivery:** follow [the Vercel release and operations guide](./docs/production-release.md)
and [the readiness report](./docs/production-readiness.md). Complete the legal identity and
commercial configuration, then verify real providers before opening the store. The dashboard
at `/admin/settings/production` lists configuration gaps and failed notifications.

## Tech stack

- **Framework**: Next.js 16 (App Router), React 19, TypeScript (strict)
- **Styling**: Tailwind CSS v4 + shadcn/ui + Lucide icons
- **Database**: PostgreSQL, hosted on Supabase
- **ORM**: Prisma 7 (driver adapter, server-only)
- **Auth**: Better Auth (email/password; database-backed sessions)
- **Storage**: Supabase Storage, behind a provider abstraction
- **Forms/validation**: React Hook Form + Zod, validated again on the server
- **Testing**: Vitest (unit/integration) + Playwright (e2e)
- **Tooling**: ESLint, Prettier, npm

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full rationale behind these choices.

## Prerequisites

- Node.js 22.14+ within the compatible Node 22 line
- npm
- A Supabase project (for `DATABASE_URL`/`DIRECT_URL`) — see [DATABASE.md](./DATABASE.md)
- Docker (optional but recommended) for a local test database + Mailpit — see below

## Local setup

```bash
npm install
cp .env.example .env
# fill in .env — see "Environment variables" below
npx prisma generate
npm run db:dev:up        # start a local Postgres (postgres-dev, via Docker)
npm run db:dev:migrate   # apply migrations to it
npm run db:dev:seed      # roles, permissions, store config
npm run dev
```

The app runs at http://localhost:3000. **`npm run dev` always connects to the local `postgres-dev`
database, never the real Supabase database** — see
[DATABASE.md](./DATABASE.md#local-development-database-postgres-dev) for why, and how to reach
Supabase deliberately (`npm run dev:remote -- --yes`) if you ever genuinely need to.

### Environment variables

Copy `.env.example` to `.env` and fill in real values. Full explanation of each variable group
in [DATABASE.md](./DATABASE.md) (database), [SECURITY.md](./SECURITY.md) (auth/secrets), and
[INTEGRATIONS.md](./INTEGRATIONS.md) (email/storage). Never commit `.env`.

### Local Postgres + Mailpit (via Docker)

`docker-compose.yml` provides every local-only service this project uses — **not** the real
Supabase database, which is only ever reached deliberately (see above):

```bash
docker compose up -d              # everything: postgres-dev, postgres-test, Mailpit
# or start just one service, e.g.:
npm run db:dev:up                 # postgres-dev only
```

This starts:

- **postgres-dev** on `localhost:56033` (`DEV_DATABASE_URL`) — used by `npm run dev`, see
  [DATABASE.md](./DATABASE.md#local-development-database-postgres-dev).
- **postgres-test** on `localhost:56032` (`TEST_DATABASE_URL`) — used only by
  `npm run test:integration`/`test:migrations`/`test:e2e`, never by `npm run dev`.
- **Mailpit** (SMTP on `localhost:1025`, web UI at http://localhost:8025) captures local test
  emails. Production uses a real SMTP relay with TLS and a verified sender domain.

## Available scripts

| Command                           | Purpose                                                                                                                                                                       |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Start the dev server — **always postgres-dev**, fail-closed, never Supabase                                                                                                   |
| `npm run dev:local`               | Alias for `npm run dev`                                                                                                                                                       |
| `npm run dev:remote -- --yes`     | Start the dev server against the **real Supabase database**, deliberately                                                                                                     |
| `npm run build`                   | Production build                                                                                                                                                              |
| `npm run start`                   | Start the production server                                                                                                                                                   |
| `npm run lint`                    | ESLint                                                                                                                                                                        |
| `npm run format` / `format:check` | Prettier write / check                                                                                                                                                        |
| `npm run typecheck`               | `tsc --noEmit`                                                                                                                                                                |
| `npm run prisma:generate`         | Generate the Prisma client                                                                                                                                                    |
| `npm run prisma:migrate`          | `prisma migrate dev` against raw `DATABASE_URL`/`DIRECT_URL` — not for local dev, see [DATABASE.md](./DATABASE.md#commands-that-intentionally-still-use-the-raw-database_url) |
| `npm run prisma:migrate:deploy`   | `prisma migrate deploy` — same caveat as above                                                                                                                                |
| `npm run prisma:seed`             | Run the production-safe seed (against whatever `DATABASE_URL` currently is)                                                                                                   |
| `npm run db:dev:up`               | Start the postgres-dev Docker container                                                                                                                                       |
| `npm run db:dev:migrate`          | Apply migrations to `DEV_DATABASE_URL` (postgres-dev)                                                                                                                         |
| `npm run db:dev:seed`             | Run the seed against `DEV_DATABASE_URL` (postgres-dev)                                                                                                                        |
| `npm run db:test:migrate`         | Apply migrations to `TEST_DATABASE_URL`                                                                                                                                       |
| `npm run test` / `test:unit`      | Unit tests (no database)                                                                                                                                                      |
| `npm run test:integration`        | Integration tests, forced onto `TEST_DATABASE_URL`                                                                                                                            |
| `npm run test:e2e`                | Playwright smoke tests, forced onto `TEST_DATABASE_URL`                                                                                                                       |

## Migrations and seeding

For local development, against postgres-dev:

```bash
npm run db:dev:migrate       # applies migrations to DEV_DATABASE_URL (postgres-dev)
npm run db:dev:seed          # roles, permissions, store config, optional initial admin
```

`npx prisma migrate dev`/`npm run prisma:seed` (no wrapper) apply to whatever `DATABASE_URL` is
raw in `.env` (Supabase, by default) — see
[DATABASE.md](./DATABASE.md#commands-that-intentionally-still-use-the-raw-database_url). Not
needed for local development; only for a deliberate real migration/seed against Supabase.

The seed is idempotent and production-safe — see [DATABASE.md](./DATABASE.md#seed-strategy) for
exactly what it creates (and what it deliberately never creates).

## Testing

```bash
npm run test              # unit — no database required
npm run db:test:migrate   # once, against TEST_DATABASE_URL
npm run test:integration  # integration — real Postgres, never dev/prod
npm run test:e2e          # Playwright, needs TEST_DATABASE_URL + a browser
```

## Documentation

- [ROADMAP.md](./ROADMAP.md) — what's implemented, what's next
- [ARCHITECTURE.md](./ARCHITECTURE.md) — modular monolith, module boundaries, auth/authz design
- [DATABASE.md](./DATABASE.md) — schema, connection strategy, monetary/timezone conventions
- [SECURITY.md](./SECURITY.md) — security decisions and known gaps
- [PERMISSIONS.md](./PERMISSIONS.md) — role/permission catalog and matrix
- [INTEGRATIONS.md](./INTEGRATIONS.md) — external integration boundaries (Mercado Pago,
  Andreani, ARCA, Supabase Storage, email, CSV migration imports)
- [CONTRIBUTING.md](./CONTRIBUTING.md) — local workflow, conventions, PR checklist
- [docs/adr/](./docs/adr/) — architecture decision records (monetary strategy, inventory
  ledger/balance design)
