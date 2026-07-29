import path from "node:path";

import { defineConfig } from "vitest/config";

// Deliberately separate from vitest.config.ts (unit tests), not a branch of
// it: integration tests share one real Postgres (TEST_DATABASE_URL) and
// need a database-resetting globalSetup plus serial file execution — two
// test files truncating/reseeding the same database at once would race.
// Unit tests need neither, and must never require a database at all, so a
// single shared config trying to do both would risk one bleeding into the
// other. Invoked via `npm run test:integration`, which forces
// DATABASE_URL/DIRECT_URL to TEST_DATABASE_URL first (scripts/with-test-db.mjs).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Same documented workaround as vitest.config.ts: "server-only" throws
      // unconditionally outside Next's "react-server" export condition,
      // which Vitest doesn't set.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    globalSetup: ["./tests/integration/global-setup.ts"],
    // Integration tests mutate shared database state (via the one-time
    // global reset/reseed above, and some tests intentionally read/restore
    // shared rows — e.g. roles-service.test.ts's WAREHOUSE permission
    // test). Running test files concurrently would let them race against
    // each other; running them serially makes the suite deterministic.
    fileParallelism: false,
  },
});
