// Temporary, opt-in server-side timing instrumentation for the Product Flow
// Stabilization Sprint's performance investigation (see the real-server
// timings gathered in scripts/manual-flow-check.ts: ~10s login, ~7s product
// detail load). Off by default, never active in production regardless of
// the flag, and deliberately reads process.env directly rather than the
// validated env object — several call sites this wraps (modules/roles/
// service-core.ts, modules/products/service-core.ts) have no "server-only"
// import so they stay importable from Playwright's plain-Node test-runner
// process; importing the "server-only"-guarded env module here would break
// that. Set DEBUG_TIMING=true locally to see per-call timings in the
// `next dev` server log.
const ENABLED = process.env.DEBUG_TIMING === "true" && process.env.NODE_ENV !== "production";

export async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!ENABLED) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    console.log(`[timing] ${label}: ${(performance.now() - start).toFixed(1)}ms`);
  }
}
