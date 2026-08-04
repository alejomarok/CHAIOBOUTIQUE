import { resetTestDatabase } from "../integration/reset-db";

// Runs once after the whole Playwright run finishes (pass or fail),
// regardless of what individual specs left behind — a full truncate+reseed
// of the same isolated Docker test database global-setup.ts already
// validated, so the suite never depends on every spec's own per-test
// cleanup (tests/e2e/*.spec.ts's own `afterEach` arrays) having run
// perfectly. TRUNCATE never touches `_prisma_migrations` or drops/creates
// schemas, so applied migration history is preserved — see
// tests/integration/reset-db.ts.
export default async function globalTeardown() {
  await resetTestDatabase();
}
