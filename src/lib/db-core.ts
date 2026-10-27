import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env-core";
import { databaseConnectionOptions } from "@/lib/database-connection";

// Node-safe core: no "server-only" import, and imports env-core.ts (not
// env.ts) so the CLI-safe chain never re-enters a "server-only"-guarded
// module. See src/lib/env-core.ts and src/lib/db.ts.

// Prisma 7 requires an explicit driver adapter. DATABASE_URL is the pooled
// Supabase connection (pgbouncer, port 6543) — safe for many short-lived
// serverless connections. Migrations use DIRECT_URL instead; see
// prisma.config.ts and DATABASE.md.
const adapter = new PrismaPg(databaseConnectionOptions(env.DATABASE_URL));

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Captured before the assignment below — true only the first time this
// module runs in a given process (a fresh `next dev`/`next start`), false
// on every subsequent Turbopack HMR re-evaluation, which reuses the cached
// client from globalThis instead of constructing (and re-logging) a new one.
const isFreshProcess = !globalForPrisma.prisma;

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Local Development Performance checkpoint: with three databases now
// reachable (Supabase remote, postgres-dev, postgres-test), which one a
// given `next dev`/`next start` process is actually talking to must never
// be a guess — logged once at startup, host + database name only, never
// credentials or the full connection string. `npm run dev`/`dev:local`
// (with-dev-db.mjs forces DATABASE_URL to DEV_DATABASE_URL — the default,
// safe command), `npm run dev:remote` (with-remote-db.mjs, deliberate and
// explicitly gated — see that script), and the test runners
// (with-test-db.mjs) each produce a visibly different line here.
//
// Made deliberately loud (a bordered, multi-line banner, not a single easy-
// to-miss log line) after a real incident: a plain `npm run dev` used to
// silently use whatever DATABASE_URL was raw in .env (Supabase by default),
// and the admin dashboard failed with a confusing P2022 "column does not
// exist" error (Supabase intentionally lags behind postgres-dev's applied
// migrations — see DATABASE.md). `npm run dev` is now wrapped by
// with-dev-db.mjs and can no longer reach this REMOTE SUPABASE branch at
// all — seeing it now means either `npm run dev:remote` (deliberate) or a
// production-adjacent command (`build`/`start`/a raw `prisma migrate ...`).
// The two headline strings below ("DATABASE: LOCAL DEVELOPMENT" /
// "DATABASE: REMOTE SUPABASE") are grep-able and meant to be impossible to
// scroll past unnoticed.
if (env.NODE_ENV !== "production" && isFreshProcess) {
  try {
    const parsed = new URL(env.DATABASE_URL);
    const databaseName = parsed.pathname.replace(/^\//, "").split("?")[0];
    const isLocalHost = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const isRemote = !isLocalHost;
    const kind = isLocalHost
      ? parsed.port === "56033"
        ? "local development (postgres-dev)"
        : parsed.port === "56032"
          ? "local test (postgres-test)"
          : "local Postgres (unrecognized port)"
      : "remote (Supabase)";
    const headline = isRemote ? "DATABASE: REMOTE SUPABASE" : "DATABASE: LOCAL DEVELOPMENT";
    const border = "=".repeat(Math.max(headline.length + 4, 48));
    console.log(
      [
        "",
        border,
        `  ${headline}`,
        `  ${kind} — ${parsed.hostname}:${parsed.port || "5432"}/${databaseName}`,
        ...(isRemote
          ? [
              "  ⚠ This is the REAL Supabase database, not postgres-dev.",
              "  ⚠ Expected only for `npm run dev:remote`, a production-adjacent",
              "  ⚠ command (build/start), or a raw `prisma migrate ...` invocation —",
              "  ⚠ never plain `npm run dev`, which always uses postgres-dev.",
            ]
          : []),
        border,
        "",
      ].join("\n"),
    );
  } catch {
    // Never let a logging convenience break startup over an unparseable URL
    // — env-core.ts already validated DATABASE_URL is a non-empty string.
  }
}
