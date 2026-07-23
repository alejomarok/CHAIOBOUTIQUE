// Runs a command with DATABASE_URL and DIRECT_URL forced to TEST_DATABASE_URL.
// This is the only supported way integration tests / test migrations touch a
// database: it refuses to run if TEST_DATABASE_URL is missing rather than
// silently falling back to the dev/prod DATABASE_URL.
import "dotenv/config";
import { spawnSync } from "node:child_process";

const testUrl = process.env.TEST_DATABASE_URL;

if (!testUrl) {
  console.error(
    "TEST_DATABASE_URL is not set. Refusing to run against DATABASE_URL. " +
      "Set TEST_DATABASE_URL in your .env (see .env.example) to a database " +
      "that is not your development or production database.",
  );
  process.exit(1);
}

const [command, ...args] = process.argv.slice(2);

if (!command) {
  console.error("Usage: node scripts/with-test-db.mjs <command> [...args]");
  process.exit(1);
}

const result = spawnSync(command, args, {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    DATABASE_URL: testUrl,
    DIRECT_URL: testUrl,
  },
});

process.exit(result.status ?? 1);
