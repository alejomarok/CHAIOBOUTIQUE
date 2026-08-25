import path from "node:path";

import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // node-forge is a large CJS dependency (see modules/fiscal-documents/
  // arca/wsaa-core.ts) — pre-listing it here avoids a lazy dependency-
  // optimization pass triggering mid-run the first time a worker imports
  // it.
  optimizeDeps: { include: ["node-forge"] },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The "server-only" package throws unconditionally unless bundled
      // with Next's "react-server" export condition. Vitest doesn't set
      // that condition, so alias it to its own no-op branch — this is the
      // documented workaround for testing server-only modules under Vitest.
      "server-only": path.resolve(__dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    // Default environment covers unit tests, including the few that render
    // React components. Integration tests (tests/integration/**) override
    // this to "node" per-file via a `// @vitest-environment node` pragma —
    // they talk to a real Postgres, not the DOM.
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    // Explicitly loaded here (via Vite's own loadEnv, called synchronously
    // during config resolution — always complete before any worker spawns)
    // and injected into every worker's process.env before it runs any test
    // file. Without this, src/lib/env-core.ts's module-level required-var
    // parse depends on process.env already being populated by the time a
    // given worker's module graph first evaluates it — which raced and
    // intermittently lost for a couple of test files once this suite grew
    // enough files/workers to expose the gap (empty-prefix loadEnv reads
    // ALL vars from .env, not just VITE_-prefixed ones, matching what
    // env-core.ts itself expects).
    env: loadEnv(mode, process.cwd(), ""),
  },
}));
