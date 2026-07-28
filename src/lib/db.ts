import "server-only";

// The actual PrismaClient construction lives in db-core.ts, which has no
// "server-only" import so it stays importable from a plain Node context
// (prisma/seed.ts via `tsx`) — see that file and ARCHITECTURE.md. Every
// Next.js-side module keeps importing "@/lib/db" unchanged.
export { prisma } from "./db-core";
