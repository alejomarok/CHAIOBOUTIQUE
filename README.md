# CHAIOBOUTIQUE

Women's fashion store platform: public ecommerce storefront, customer account area, internal
administration panel, and point-of-sale — one modular-monolith Next.js application backed by
PostgreSQL.

**This repository currently contains the foundation phase only.** See [ROADMAP.md](./ROADMAP.md)
for what's implemented vs. planned. There is no catalog, inventory, sales, payments, shipping, or
invoicing yet — those each get their own reviewed data model before implementation.

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

- Node.js 20.9+ (project developed against Node 22)
- npm
- A Supabase project (for `DATABASE_URL`/`DIRECT_URL`) — see [DATABASE.md](./DATABASE.md)
- Docker (optional but recommended) for a local test database + Mailpit — see below

## Local setup

```bash
npm install
cp .env.example .env
# fill in .env — see "Environment variables" below
npx prisma generate
npx prisma migrate dev
npm run prisma:seed
npm run dev
```

The app runs at http://localhost:3000.

### Environment variables

Copy `.env.example` to `.env` and fill in real values. Full explanation of each variable group
in [DATABASE.md](./DATABASE.md) (database), [SECURITY.md](./SECURITY.md) (auth/secrets), and
[INTEGRATIONS.md](./INTEGRATIONS.md) (email/storage). Never commit `.env`.

### Local test database + Mailpit (optional, via Docker)

Integration tests and the password-reset email flow need services that are **not** your Supabase
dev database:

```bash
docker compose up -d
```

This starts:

- A local Postgres on `localhost:55432` — set `TEST_DATABASE_URL` in `.env` to
  `postgresql://chaioboutique_test:chaioboutique_test@localhost:55432/chaioboutique_test`
- Mailpit (SMTP on `localhost:1025`, web UI at http://localhost:8025) — password-reset emails
  land there in dev, since no production email provider is wired up yet.

## Available scripts

| Command                           | Purpose                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| `npm run dev`                     | Start the dev server                                       |
| `npm run build`                   | Production build                                           |
| `npm run start`                   | Start the production server                                |
| `npm run lint`                    | ESLint                                                     |
| `npm run format` / `format:check` | Prettier write / check                                     |
| `npm run typecheck`               | `tsc --noEmit`                                             |
| `npm run prisma:generate`         | Generate the Prisma client                                 |
| `npm run prisma:migrate`          | `prisma migrate dev` (against `DATABASE_URL`/`DIRECT_URL`) |
| `npm run prisma:migrate:deploy`   | `prisma migrate deploy`                                    |
| `npm run prisma:seed`             | Run the production-safe seed                               |
| `npm run db:test:migrate`         | Apply migrations to `TEST_DATABASE_URL`                    |
| `npm run test` / `test:unit`      | Unit tests (no database)                                   |
| `npm run test:integration`        | Integration tests, forced onto `TEST_DATABASE_URL`         |
| `npm run test:e2e`                | Playwright smoke tests                                     |

## Migrations and seeding

```bash
npx prisma migrate dev       # applies migrations to DATABASE_URL/DIRECT_URL (dev)
npm run prisma:seed          # roles, permissions, store config, optional initial admin
```

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
  Andreani, ARCA, Supabase Storage, email)
- [CONTRIBUTING.md](./CONTRIBUTING.md) — local workflow, conventions, PR checklist
