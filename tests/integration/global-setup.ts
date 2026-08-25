// Vitest globalSetup for the integration suite only — wired in via
// vitest.integration.config.ts, never the unit-test config (unit tests must
// never require a database). Runs exactly once per `vitest run` invocation,
// before any integration test file starts, so the whole suite begins from a
// known-clean, freshly-seeded database. See tests/integration/reset-db.ts
// for why a full reset replaces per-entity teardown.
import { resetTestDatabase } from "./reset-db";

export default async function setup() {
  // Mercado Pago test configuration is NOT set here — this function runs in
  // a separate process from the worker processes that actually execute test
  // files, so a process.env mutation made here is never observed by
  // env-core.ts's `env` object in a worker (that module snapshots
  // process.env once, per worker process, at import time). A prior version
  // of this file mutated process.env.MERCADO_PAGO_* here believing it would
  // be inherited — it silently did nothing, and every test that actually
  // exercised createMercadoPagoPreference/getMercadoPagoConfig() failed with
  // MercadoPagoNotConfiguredError. See modules/payments/mercado-pago/
  // config-core.ts's setMercadoPagoConfigForTesting (an in-process
  // dependency-injection override, the same pattern already used for
  // setMercadoPagoClientForTesting) — every test that needs Mercado Pago
  // "configured" calls that directly, in its own beforeEach, in the actual
  // worker process where it matters. See
  // tests/integration/mercado-pago-payments.test.ts.
  await resetTestDatabase();
}
