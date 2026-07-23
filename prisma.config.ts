import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7: this file controls what the Prisma CLI (migrate, db push, studio,
// db seed) connects to. It intentionally uses DIRECT_URL, not DATABASE_URL —
// Supabase's transaction pooler (DATABASE_URL) cannot run schema migrations.
// The Prisma Client used by the running application connects with
// DATABASE_URL instead; see src/lib/db.ts. See DATABASE.md for the full
// rationale.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
