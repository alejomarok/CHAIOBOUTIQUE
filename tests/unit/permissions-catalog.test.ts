import { describe, expect, it } from "vitest";

import { isPermission, PERMISSION_LABELS_ES, PERMISSIONS } from "@/modules/permissions/catalog";

describe("permissions catalog", () => {
  it("has no duplicate keys", () => {
    const unique = new Set(PERMISSIONS);
    expect(unique.size).toBe(PERMISSIONS.length);
  });

  it("has a Spanish label for every permission key", () => {
    for (const key of PERMISSIONS) {
      expect(PERMISSION_LABELS_ES[key], `missing label for "${key}"`).toBeTruthy();
    }
  });

  it("has no orphan labels for keys that no longer exist", () => {
    const keySet = new Set<string>(PERMISSIONS);
    for (const key of Object.keys(PERMISSION_LABELS_ES)) {
      expect(keySet.has(key), `label exists for unknown permission "${key}"`).toBe(true);
    }
  });

  it("isPermission accepts every catalog key", () => {
    for (const key of PERMISSIONS) {
      expect(isPermission(key)).toBe(true);
    }
  });

  it("isPermission rejects unknown strings", () => {
    expect(isPermission("products.viewcost")).toBe(false);
    expect(isPermission("")).toBe(false);
    expect(isPermission("products.view ")).toBe(false);
  });

  it("every key follows the <resource>.<action> shape", () => {
    for (const key of PERMISSIONS) {
      expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }
  });
});
