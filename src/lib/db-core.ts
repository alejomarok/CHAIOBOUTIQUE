import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env-core";

// Node-safe core: no "server-only" import, and imports env-core.ts (not
// env.ts) so the CLI-safe chain never re-enters a "server-only"-guarded
// module. See src/lib/env-core.ts and src/lib/db.ts.

// Prisma 7 requires an explicit driver adapter. DATABASE_URL is the pooled
// Supabase connection (pgbouncer, port 6543) — safe for many short-lived
// serverless connections. Migrations use DIRECT_URL instead; see
// prisma.config.ts and DATABASE.md.
const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });

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
// credentials or the full connection string. `npm run dev` (Supabase),
// `npm run dev:local` (with-dev-db.mjs forces DATABASE_URL to
// DEV_DATABASE_URL), and the test runners (with-test-db.mjs) each produce a
// visibly different line here.
if (env.NODE_ENV !== "production" && isFreshProcess) {
  try {
    const parsed = new URL(env.DATABASE_URL);
    const databaseName = parsed.pathname.replace(/^\//, "").split("?")[0];
    const kind =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"
        ? parsed.port === "56033"
          ? "local development (postgres-dev)"
          : parsed.port === "56032"
            ? "local test (postgres-test)"
            : "local Postgres (unrecognized port)"
        : "remote (Supabase)";
    console.log(`[db] Connected to: ${kind} — ${parsed.hostname}:${parsed.port || "5432"}/${databaseName}`);
  } catch {
    // Never let a logging convenience break startup over an unparseable URL
    // — env-core.ts already validated DATABASE_URL is a non-empty string.
  }
}
