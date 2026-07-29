// Vitest globalSetup for the integration suite only — wired in via
// vitest.integration.config.ts, never the unit-test config (unit tests must
// never require a database). Runs exactly once per `vitest run` invocation,
// before any integration test file starts, so the whole suite begins from a
// known-clean, freshly-seeded database. See tests/integration/reset-db.ts
// for why a full reset replaces per-entity teardown.
import { resetTestDatabase } from "./reset-db";

export default async function setup() {
  await resetTestDatabase();
}
