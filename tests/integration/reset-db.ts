// Full-database reset for the isolated test database — replaces per-entity
// cleanup, which became unsafe once real DB-level invariants exist:
//   - audit_log has a BEFORE UPDATE OR DELETE append-only trigger, so
//     deleting a User (whose id audit_log.userId references with
//     onDelete: SetNull) fails: the SetNull cascade is itself an UPDATE,
//     which the trigger correctly rejects.
//   - inventory_balance/inventory_movement reference ProductVariant/
//     Warehouse with onDelete: Restrict, so deleting a variant or warehouse
//     that ever had an inventory operation applied to it fails too.
// Row-by-row teardown can't work around either without weakening a real
// production invariant. TRUNCATE ... CASCADE is the correct tool here
// specifically because Postgres does NOT fire BEFORE UPDATE OR DELETE
// triggers for TRUNCATE (it's a distinct trigger event) — the append-only
// tables get wiped cleanly without ever touching the trigger, while still
// being fully protected against UPDATE/DELETE during normal operation.
//
// This is only ever safe against the isolated test database — see
// assertSafeToResetTestDatabase below. Imports db-core.ts/seed-core.ts
// (not the "server-only" wrappers) so this module has no dependency on
// being run under Vitest's "server-only" alias specifically — it's usable
// from any Node-safe CLI/tooling context.
import { prisma } from "@/lib/db-core";
import { env } from "@/lib/env-core";
import {
  seedPermissions,
  seedRolesAndAssignments,
  seedStoreConfiguration,
} from "@/modules/roles/seed-core";

const EXPECTED_TEST_HOST = "localhost";
const EXPECTED_TEST_PORT = "55432";
const EXPECTED_TEST_DATABASE_NAME = "chaioboutique_test";

// Every application table, in no particular order — TRUNCATE ... CASCADE
// resolves foreign-key dependency order itself. Table names copied
// verbatim from the applied migration.sql, not assumed.
const ALL_APPLICATION_TABLES = [
  "user",
  "session",
  "account",
  "verification",
  "role",
  "permission",
  "user_role",
  "role_permission",
  "store_configuration",
  "audit_log",
  "category",
  "brand",
  "size",
  "color",
  "product",
  "product_variant",
  "product_image",
  "warehouse",
  "inventory_balance",
  "inventory_operation",
  "inventory_movement",
  "import_batch",
  "import_issue",
  // Phase 3A — customer registration. Names match this schema's @@map
  // directives exactly (verified against schema.prisma, not assumed —
  // confirmed again once the Phase 3 migration is generated).
  "public_registration_intent",
  "customer_profile",
  "customer_consent",
] as const;

// Defense in depth, layered beyond guard.ts's "DATABASE_URL === TEST_DATABASE_URL"
// check: even if that were somehow satisfied against a non-test database
// (e.g. a misconfigured .env), a destructive full-table TRUNCATE additionally
// requires the connection to visibly be the local, disposable Postgres this
// repo's docker-compose.yml provisions — host, port, AND database name all
// have to match. Any mismatch throws instead of proceeding; there is no
// override flag, deliberately.
function assertSafeToResetTestDatabase(): void {
  const testUrl = process.env.TEST_DATABASE_URL;
  const activeUrl = process.env.DATABASE_URL;

  if (!testUrl) {
    throw new Error("TEST_DATABASE_URL is not set. Refusing to reset any database.");
  }
  if (activeUrl !== testUrl) {
    throw new Error(
      "DATABASE_URL does not match TEST_DATABASE_URL. Refusing to reset a database that " +
        "might be your development or production database.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(activeUrl);
  } catch {
    throw new Error(`TEST_DATABASE_URL is not a valid URL: "${activeUrl}".`);
  }

  const host = parsed.hostname;
  const port = parsed.port;
  const databaseName = parsed.pathname.replace(/^\//, "").split("?")[0];

  const isSafeHost = host === EXPECTED_TEST_HOST || host === "127.0.0.1";
  const isSafePort = port === EXPECTED_TEST_PORT;
  const isSafeDatabaseName = databaseName === EXPECTED_TEST_DATABASE_NAME;

  if (!isSafeHost || !isSafePort || !isSafeDatabaseName) {
    throw new Error(
      "Refusing to reset a database that doesn't look like the local isolated test " +
        `database (expected ${EXPECTED_TEST_HOST}:${EXPECTED_TEST_PORT}/` +
        `${EXPECTED_TEST_DATABASE_NAME}, got "${host}:${port}/${databaseName}"). If your ` +
        "test database genuinely lives somewhere else, update this check deliberately in " +
        "tests/integration/reset-db.ts — never bypass it.",
    );
  }
}

// Wipes every application table and re-seeds the fixtures every integration
// test implicitly relies on existing (system roles, the permission catalog,
// role-permission assignments, base store configuration) — reusing the exact
// same idempotent seed functions prisma/seed.ts uses in production, so
// there's one seed implementation, not two. Called once, from
// tests/integration/global-setup.ts, before any integration test file runs.
export async function resetTestDatabase(): Promise<void> {
  assertSafeToResetTestDatabase();

  const tableList = ALL_APPLICATION_TABLES.map((name) => `"${name}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);

  await seedPermissions();
  await seedRolesAndAssignments();
  // Sourced from the same validated env config prisma/seed.ts's production
  // seed uses (env.STORE_NAME/STORE_CURRENCY/STORE_LOCALE/STORE_TIMEZONE) —
  // never a hardcoded literal here. If TEST_DATABASE_URL's .env deliberately
  // sets a distinguishable STORE_NAME (e.g. "CHAIOBOUTIQUE Test") to mark
  // test data, that flows through automatically; there is exactly one
  // source of truth for this value, not one hardcoded per call site.
  await seedStoreConfiguration({
    name: env.STORE_NAME,
    currency: env.STORE_CURRENCY,
    locale: env.STORE_LOCALE,
    timezone: env.STORE_TIMEZONE,
  });
}
