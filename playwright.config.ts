import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

import { assertSafeToResetTestDatabase } from "./tests/integration/reset-db";

// This import transitively reaches the generated Prisma client
// (src/generated/prisma/client.ts). That file must stay generated with
// `moduleFormat = "cjs"` (see the `generator client` block in
// prisma/schema.prisma) — the ESM-flavored default output uses
// `import.meta.url`, which breaks under Playwright's config/test loader (a
// synchronous CJS-`require()`-compatible transform, since this project has
// no `"type": "module"` in package.json). Re-running `prisma generate`
// keeps the cjs format as long as that schema.prisma setting stays in
// place — never remove it without re-verifying `npm run test:e2e`.

// Fails fast, with one clear message, before a browser or webServer ever
// starts, unless DATABASE_URL unambiguously points at the local Docker test
// database (see tests/integration/reset-db.ts) — the same guard
// tests/e2e/global-setup.ts re-runs before touching anything. By the time
// this file is evaluated, package.json's "test:e2e" script has already
// forced DATABASE_URL/DIRECT_URL to TEST_DATABASE_URL via
// scripts/with-test-db.mjs; running `playwright test` any other way (without
// that wrapper) is exactly what this is meant to catch.
assertSafeToResetTestDatabase();

// A fixed, e2e-only port — never port 3000, so this never depends on (or
// collides with) a manually running `npm run dev`. BETTER_AUTH_URL and
// NEXT_PUBLIC_APP_URL are overridden to match below; otherwise Better Auth
// would reject every request from this origin as "Invalid origin" (its
// trusted origin defaults to BETTER_AUTH_URL, which a plain .env sets to
// port 3000).
const E2E_PORT = 3100;
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
const testDatabaseUrl = process.env.TEST_DATABASE_URL ?? "";
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  // The suite shares one real Postgres database and one webServer instance
  // across every spec (fixture users, and each spec's own afterEach cleanup
  // race against anything running concurrently) — no per-worker database or
  // storage isolation is implemented, so this must stay serial.
  workers: 1,
  retries: isCI ? 1 : 0,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  // Always starts a fresh instance (reuseExistingServer: false) — this must
  // never silently attach to a developer's already-running `next dev`,
  // which would carry the wrong DATABASE_URL/BETTER_AUTH_URL/storage
  // provider. If port 3100 (or the project directory's own dev lockfile) is
  // already occupied by another Next.js process, this intentionally fails
  // loudly instead of reusing it — stop that process first.
  webServer: {
    command: `npx next dev -p ${E2E_PORT}`,
    url: E2E_BASE_URL,
    reuseExistingServer: false,
    env: {
      ...process.env,
      DATABASE_URL: testDatabaseUrl,
      DIRECT_URL: testDatabaseUrl,
      BETTER_AUTH_URL: E2E_BASE_URL,
      NEXT_PUBLIC_APP_URL: E2E_BASE_URL,
      // Switches modules/storage's getStorageProvider() to the in-memory,
      // locally-served provider — see modules/storage/e2e-provider.ts. The
      // real product-images Supabase bucket is never touched by this suite.
      E2E_TEST_MODE: "true",
    },
    timeout: 60_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
