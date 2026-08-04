import "server-only";

// The actual implementations live in service-core.ts, which has no
// "server-only" import so it stays importable from a plain Node context
// (Playwright's test-runner process) — see that file and ARCHITECTURE.md.
// Every Next.js-side module keeps importing "@/modules/products/service"
// unchanged.
export * from "./service-core";
