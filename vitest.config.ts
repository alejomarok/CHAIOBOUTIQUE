import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
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
  },
});
