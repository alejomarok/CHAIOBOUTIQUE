import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement ResizeObserver — Radix primitives that measure
// their own size (Checkbox, Select, Slider, ...) need it just to mount.
// A no-op stub is all any component render test needs; nothing here
// asserts on actual resize behavior.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
