import { describe, expect, it } from "vitest";

import { isAuthorizedForPath, resolvePostLoginDestination } from "@/modules/auth/post-login-redirect";
import type { Permission } from "@/modules/permissions/catalog";

function user(roles: string[], ...permissionKeys: Permission[]) {
  return { roles, permissions: new Set(permissionKeys) };
}

describe("resolvePostLoginDestination", () => {
  it("sends a user with admin.access to /admin", () => {
    expect(resolvePostLoginDestination(user(["ADMIN"], "admin.access"))).toBe("/admin");
  });

  it("sends a user with both admin.access and pos.access to /admin (priority order)", () => {
    expect(resolvePostLoginDestination(user(["MANAGER"], "admin.access", "pos.access"))).toBe(
      "/admin",
    );
  });

  it("sends a user with only pos.access (no admin.access) to /pos", () => {
    // No current role has pos.access without also having admin.access —
    // this exercises the dormant branch reserved for a future POS-only
    // role. See modules/roles/catalog.ts.
    expect(resolvePostLoginDestination(user(["SALES_REPRESENTATIVE"], "pos.access"))).toBe(
      "/pos",
    );
  });

  it("sends a CUSTOMER-role user to /catalog — by role, never by permission count", () => {
    expect(resolvePostLoginDestination(user(["CUSTOMER"]))).toBe("/catalog");
  });

  it("sends a user with no roles and no portal-access permissions to / safely", () => {
    expect(resolvePostLoginDestination(user([]))).toBe("/");
  });

  it("never returns /account for any input — that route doesn't exist until Phase 3C", () => {
    expect(resolvePostLoginDestination(user(["CUSTOMER"]))).not.toMatch(/^\/account/);
    expect(resolvePostLoginDestination(user([]))).not.toMatch(/^\/account/);
    expect(resolvePostLoginDestination(user(["ADMIN"], "admin.access"))).not.toMatch(/^\/account/);
    expect(resolvePostLoginDestination(user(["WAREHOUSE"], "admin.access"))).not.toMatch(
      /^\/account/,
    );
  });
});

describe("isAuthorizedForPath", () => {
  it("authorizes /admin only for accounts with admin.access", () => {
    expect(isAuthorizedForPath("/admin", { permissions: new Set(["admin.access"]) })).toBe(true);
    expect(
      isAuthorizedForPath("/admin/products", { permissions: new Set(["admin.access"]) }),
    ).toBe(true);
    expect(isAuthorizedForPath("/admin", { permissions: new Set() })).toBe(false);
  });

  it("authorizes /pos only for accounts with pos.access", () => {
    expect(isAuthorizedForPath("/pos", { permissions: new Set(["pos.access"]) })).toBe(true);
    expect(isAuthorizedForPath("/pos", { permissions: new Set() })).toBe(false);
    // admin.access alone doesn't imply pos.access.
    expect(isAuthorizedForPath("/pos", { permissions: new Set(["admin.access"]) })).toBe(false);
  });

  it("never authorizes /account for anyone — not built yet, admin.access included", () => {
    expect(isAuthorizedForPath("/account", { permissions: new Set(["admin.access"]) })).toBe(
      false,
    );
    expect(
      isAuthorizedForPath("/account/profile", { permissions: new Set(["admin.access"]) }),
    ).toBe(false);
    expect(isAuthorizedForPath("/account", { permissions: new Set() })).toBe(false);
  });

  it("authorizes any other public path for any authenticated account", () => {
    expect(isAuthorizedForPath("/catalog", { permissions: new Set() })).toBe(true);
    expect(isAuthorizedForPath("/product/some-slug", { permissions: new Set() })).toBe(true);
    expect(isAuthorizedForPath("/", { permissions: new Set() })).toBe(true);
  });

  it("does not treat an unrelated path merely starting with the same letters as /admin or /pos", () => {
    // Prefix matching must be path-segment-aware, not a bare string prefix.
    expect(isAuthorizedForPath("/administrative-info", { permissions: new Set() })).toBe(true);
    expect(isAuthorizedForPath("/postales", { permissions: new Set() })).toBe(true);
  });
});
