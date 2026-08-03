import path from "node:path";

import { defineConfig } from "vitest/config";

// Dedicated config for migration-verification tests (tests/migrations/) —
// deliberately NOT vitest.integration.config.ts. That config's globalSetup
// (tests/integration/global-setup.ts) truncates and reseeds the shared
// `public` schema, which requires every table — including ones a still-
// pending migration hasn't created yet (size_group/size_option) — to
// already exist. Migration tests exist specifically to exercise behavior
// against data shaped like an EARLIER schema state, so they cannot share
// that globalSetup: running it first is exactly what fails with
// `relation "size_group" does not exist` when the migration this suite is
// meant to verify hasn't been applied to `public` yet.
//
// Tests here never touch the shared `public` schema or Prisma's migration
// history (`_prisma_migrations`) at all — each one creates its own
// uniquely-named, throwaway Postgres schema, runs a real migration.sql
// file against just that schema, and drops it in afterEach, regardless of
// pass/fail. That isolation is also what makes this config safe to run
// even while `public`'s own migration history is in a "failed" state (see
// DATABASE.md's "Size-groups migration — legacy data policy"): these
// tests don't call `prisma migrate status`/`deploy` or read
// `_prisma_migrations` at all.
//
// Invoked via `npm run test:migrations`, which (like test:integration)
// forces DATABASE_URL/DIRECT_URL to TEST_DATABASE_URL first
// (scripts/with-test-db.mjs) — but, unlike `db:test:migrate`, never
// applies any migration to that connection's `public` schema.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Same documented workaround as vitest.config.ts/vitest.integration.config.ts:
      // "server-only" throws unconditionally outside Next's "react-server"
      // export condition, which Vitest doesn't set.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/migrations/**/*.test.ts"],
    // No globalSetup — see file comment above. Each test manages its own
    // isolated schema, so there's no shared mutable state for concurrent
    // files/cases to race on; left at Vitest's default parallelism.
  },
});
