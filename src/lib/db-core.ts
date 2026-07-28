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

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
