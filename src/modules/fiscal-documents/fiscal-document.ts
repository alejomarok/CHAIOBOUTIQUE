import "server-only";

// The actual implementations live in fiscal-document-core.ts, which has no
// "server-only" import so it stays importable from a plain Node context
// (Playwright's test-runner process) — see that file and ARCHITECTURE.md.
// Every Next.js-side module imports "@/modules/fiscal-documents/
// fiscal-document" unchanged.
export * from "./fiscal-document-core";
