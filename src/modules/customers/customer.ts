import "server-only";

// The actual implementations live in customer-core.ts, which has no
// "server-only" import so it stays importable from a plain Node context
// (Playwright's test-runner process, prisma/seed.ts via tsx) — see that
// file and ARCHITECTURE.md. Every Next.js-side module imports
// "@/modules/customers/customer" unchanged.
export * from "./customer-core";
