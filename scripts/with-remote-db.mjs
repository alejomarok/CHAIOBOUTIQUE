// Explicit, deliberate remote-Supabase development mode (`npm run
// dev:remote`). Unlike with-dev-db.mjs/with-test-db.mjs, this does NOT
// force DATABASE_URL/DIRECT_URL to a different value — it runs the wrapped
// command against whatever is already raw in .env (Supabase, per
// .env.example). This script's only job is to make that choice impossible
// to reach by accident:
//   1. A loud warning banner, printed BEFORE the wrapped command starts.
//   2. A mandatory `--yes` flag the caller must pass explicitly (see
//      package.json's "dev:remote" script and DATABASE.md) — running
//      `npm run dev:remote` alone, out of habit or a typo, refuses to
//      start rather than silently connecting to the real database.
//
// This exists specifically so `npm run dev` (the default, safe command —
// see with-dev-db.mjs) can never be confused with actually wanting the
// real Supabase database: that now requires this separate, guarded
// command, never a fallback.
import "dotenv/config";

import { spawnSync } from "node:child_process";

const rawArgs = process.argv.slice(2);
const confirmedIndex = rawArgs.indexOf("--yes");
const confirmed = confirmedIndex !== -1;
const args = confirmed ? [...rawArgs.slice(0, confirmedIndex), ...rawArgs.slice(confirmedIndex + 1)] : rawArgs;

const headline = "DATABASE: REMOTE SUPABASE";
const border = "=".repeat(Math.max(headline.length + 4, 48));
console.log(
  [
    "",
    border,
    `  ${headline}`,
    "  THIS COMMAND USES THE REAL REMOTE DATABASE",
    "  Every read AND write from this process goes to the actual Supabase",
    "  project configured in DATABASE_URL/DIRECT_URL — not postgres-dev.",
    border,
    "",
  ].join("\n"),
);

if (!confirmed) {
  console.error(
    "Refusing to start: dev:remote requires an explicit --yes flag confirming you really want " +
      "to run against the real Supabase database.\n\n" +
      "  npm run dev:remote -- --yes\n\n" +
      "For everyday local development (the default, safe choice), use `npm run dev` instead — " +
      "it always uses postgres-dev (DEV_DATABASE_URL), never Supabase.",
  );
  process.exit(1);
}

if (!process.env.DATABASE_URL || !process.env.DIRECT_URL) {
  console.error(
    "DATABASE_URL/DIRECT_URL are not set in .env — dev:remote has nothing to connect to. " +
      "See .env.example.",
  );
  process.exit(1);
}

const [command, ...commandArgs] = args;

if (!command) {
  console.error("Usage: node scripts/with-remote-db.mjs <command> [...args] -- --yes");
  process.exit(1);
}

// Deliberately unchanged env — this is the one script in this project that
// is SUPPOSED to pass DATABASE_URL/DIRECT_URL through exactly as .env has
// them, rather than overriding them the way with-dev-db.mjs/
// with-test-db.mjs do.
const result = spawnSync(command, commandArgs, {
  stdio: "inherit",
  shell: true,
  env: { ...process.env },
});

process.exit(result.status ?? 1);
