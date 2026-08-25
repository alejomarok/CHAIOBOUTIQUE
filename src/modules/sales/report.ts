import "server-only";

// The actual implementation lives in report-core.ts, which has no
// "server-only" import so it stays importable from a plain Node context
// (Playwright's test-runner process, integration tests) — see that file and
// ARCHITECTURE.md. Every Next.js-side module imports
// "@/modules/sales/report" unchanged.
export * from "./report-core";
