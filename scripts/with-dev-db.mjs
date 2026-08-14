// Runs a command with DATABASE_URL and DIRECT_URL forced to
// DEV_DATABASE_URL. This is the only supported way `npm run dev:local` /
// `npm run db:dev:migrate` / `npm run db:dev:seed` touch a database: it
// refuses to run if DEV_DATABASE_URL is missing rather than silently
// falling back to whatever DATABASE_URL already is (Supabase, by default —
// see .env.example). Mirrors scripts/with-test-db.mjs exactly, plus an
// extra fail-closed check (assertSafeDevDatabase below) that the resolved
// URL is unambiguously the local postgres-dev container — never Supabase,
// never postgres-test — so a misconfigured .env can never make this script
// silently operate on the wrong database.
import "dotenv/config";
import { spawnSync } from "node:child_process";

const EXPECTED_DEV_HOST = "localhost";
const EXPECTED_DEV_PORT = "56033";
const EXPECTED_DEV_DATABASE_NAME = "chaioboutique_dev";

function assertSafeDevDatabase(devUrl) {
  let parsed;
  try {
    parsed = new URL(devUrl);
  } catch {
    throw new Error(`DEV_DATABASE_URL is not a valid URL: "${devUrl}".`);
  }

  const host = parsed.hostname;
  const port = parsed.port;
  const databaseName = parsed.pathname.replace(/^\//, "").split("?")[0];

  const isSafeHost = host === EXPECTED_DEV_HOST || host === "127.0.0.1";
  const isSafePort = port === EXPECTED_DEV_PORT;
  const isSafeDatabaseName = databaseName === EXPECTED_DEV_DATABASE_NAME;

  if (!isSafeHost || !isSafePort || !isSafeDatabaseName) {
    throw new Error(
      "DEV_DATABASE_URL doesn't look like the local postgres-dev database " +
        `(expected ${EXPECTED_DEV_HOST}:${EXPECTED_DEV_PORT}/${EXPECTED_DEV_DATABASE_NAME}, ` +
        `got "${host}:${port}/${databaseName}"). Refusing to run — this guard exists so a ` +
        "misconfigured DEV_DATABASE_URL can never point this command at Supabase or the " +
        "test database. If your local dev database genuinely lives somewhere else, update " +
        "this check deliberately in scripts/with-dev-db.mjs — never bypass it.",
    );
  }
}

const devUrl = process.env.DEV_DATABASE_URL;

if (!devUrl) {
  console.error(
    "DEV_DATABASE_URL is not set. Refusing to run against DATABASE_URL. " +
      "Set DEV_DATABASE_URL in your .env (see .env.example) to your local " +
      "postgres-dev database, or run `npm run db:dev:up` first.",
  );
  process.exit(1);
}

try {
  assertSafeDevDatabase(devUrl);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node scripts/with-dev-db.mjs <command> [...args]");
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    DATABASE_URL: devUrl,
    DIRECT_URL: devUrl,
  },
});

process.exit(result.status ?? 1);
