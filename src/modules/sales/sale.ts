import "server-only";

// The actual implementations live in sale-core.ts, which has no
// "server-only" import so it stays importable from a plain Node context
// (Playwright's test-runner process) — see that file and ARCHITECTURE.md.
// Every Next.js-side module imports "@/modules/sales/sale" unchanged.
export * from "./sale-core";
