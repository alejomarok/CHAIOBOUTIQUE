// Defense-in-depth beyond scripts/with-test-db.mjs: refuses to run if
// DATABASE_URL doesn't match TEST_DATABASE_URL, in case an integration test
// is ever invoked directly with `vitest` instead of `npm run test:integration`.
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    "TEST_DATABASE_URL is not set. Run integration tests via `npm run test:integration`, " +
      "not `vitest` directly.",
  );
}

if (process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
  throw new Error(
    "DATABASE_URL does not match TEST_DATABASE_URL. Refusing to run integration tests " +
      "against a non-test database. Run via `npm run test:integration`.",
  );
}
