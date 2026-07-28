import "server-only";

// The actual schema/validation lives in env-core.ts, which has no
// "server-only" import so it stays importable from a plain Node context
// (prisma/seed.ts, run via `tsx`, outside the Next.js bundler — the
// "server-only" package throws unconditionally there; see env-core.ts and
// ARCHITECTURE.md). Every Next.js-side module keeps importing "@/lib/env" —
// this file's only job is re-adding the guard for that context.
export { env } from "./env-core";
