import { Prisma } from "@/generated/prisma/client";

// True for P2021 ("table does not exist") or P2022 ("column does not
// exist") — the exact shape a genuinely lagging database schema produces.
// This project deliberately keeps Supabase behind postgres-dev's applied
// migrations until a phase is explicitly authorized to catch it up (see
// db-core.ts's "DATABASE: REMOTE SUPABASE" banner and DATABASE.md) — most
// visibly during `next build`'s static-generation probe, which queries
// live Supabase with whatever DATABASE_URL is raw in .env regardless of
// route dynamic-ness (see the Product Flow Stabilization Sprint's
// findings). Deliberately narrow: any OTHER Prisma error (a real
// connection failure, an actual constraint violation, ...) must never be
// swallowed by a caller using this check — see each call site's own
// comment for exactly what narrow fallback it applies, and only there.
export function isSchemaDriftError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}
