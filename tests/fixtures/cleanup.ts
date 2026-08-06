// Drains a LIFO stack of e2e teardown steps. A single step that fails —
// e.g. because the row it targets is already gone (P2025), or because the
// test itself failed partway through and never reached everything the
// stack expects — must never stop the rest of the stack from draining, and
// must never surface as a second, confusing failure layered on top of the
// real one (Playwright would otherwise report both the test's actual
// failure and an unrelated afterEach exception). Failures are logged, not
// thrown, so this always runs to completion from `test.afterEach`.
export async function runCleanup(stack: Array<() => Promise<unknown>>): Promise<void> {
  while (stack.length > 0) {
    const step = stack.pop();
    if (!step) continue;
    try {
      await step();
    } catch (error) {
      console.warn("[e2e cleanup] a teardown step failed and was skipped:", error);
    }
  }
}
