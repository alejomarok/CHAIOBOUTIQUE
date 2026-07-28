import { describe, expect, it } from "vitest";

import { isPermission, PERMISSIONS } from "@/modules/permissions/catalog";
import { ROLE_DEFINITIONS } from "@/modules/roles/catalog";

const EXPECTED_ROLE_KEYS = [
  "ADMIN",
  "MANAGER",
  "SALES_REPRESENTATIVE",
  "WAREHOUSE",
  "ACCOUNTANT",
  "CUSTOMER",
];

describe("role catalog", () => {
  it("defines exactly the 6 expected system roles", () => {
    expect(ROLE_DEFINITIONS.map((role) => role.key).sort()).toEqual([...EXPECTED_ROLE_KEYS].sort());
  });

  it("never references a permission key that doesn't exist in the catalog", () => {
    for (const role of ROLE_DEFINITIONS) {
      for (const permission of role.permissions) {
        expect(isPermission(permission), `${role.key} references unknown "${permission}"`).toBe(
          true,
        );
      }
    }
  });

  it("has no duplicate permissions within a single role", () => {
    for (const role of ROLE_DEFINITIONS) {
      const unique = new Set(role.permissions);
      expect(unique.size, `${role.key} has duplicate permissions`).toBe(role.permissions.length);
    }
  });

  it("ADMIN has every permission in the catalog", () => {
    const admin = ROLE_DEFINITIONS.find((role) => role.key === "ADMIN")!;
    expect([...admin.permissions].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("CUSTOMER has no admin/POS permissions (access is scoped by ownership instead)", () => {
    const customer = ROLE_DEFINITIONS.find((role) => role.key === "CUSTOMER")!;
    expect(customer.permissions).toHaveLength(0);
  });

  it("SALES_REPRESENTATIVE cannot view costs, profitability, or manage users/roles", () => {
    const sales = ROLE_DEFINITIONS.find((role) => role.key === "SALES_REPRESENTATIVE")!;
    expect(sales.permissions).not.toContain("products.view_cost");
    expect(sales.permissions).not.toContain("reports.view_profit");
    expect(sales.permissions).not.toContain("users.manage");
    expect(sales.permissions).not.toContain("roles.manage");
    expect(sales.permissions).not.toContain("sales.cancel");
  });

  it("WAREHOUSE has no profitability or financial permissions", () => {
    const warehouse = ROLE_DEFINITIONS.find((role) => role.key === "WAREHOUSE")!;
    expect(warehouse.permissions).not.toContain("reports.view_profit");
    expect(warehouse.permissions).not.toContain("products.view_cost");
    expect(warehouse.permissions).not.toContain("cash_register.open");
  });

  it("MANAGER cannot manage users, roles, or settings", () => {
    const manager = ROLE_DEFINITIONS.find((role) => role.key === "MANAGER")!;
    expect(manager.permissions).not.toContain("users.manage");
    expect(manager.permissions).not.toContain("roles.manage");
    expect(manager.permissions).not.toContain("settings.manage");
  });

  it("MANAGER manages the catalog but cannot execute bulk imports", () => {
    const manager = ROLE_DEFINITIONS.find((role) => role.key === "MANAGER")!;
    expect(manager.permissions).toContain("categories.manage");
    expect(manager.permissions).toContain("brands.manage");
    expect(manager.permissions).toContain("attributes.manage");
    expect(manager.permissions).toContain("warehouses.manage");
    expect(manager.permissions).toContain("product_imports.view");
    expect(manager.permissions).not.toContain("product_imports.execute");
  });

  it("WAREHOUSE can view warehouses but not manage them or curate the catalog", () => {
    const warehouse = ROLE_DEFINITIONS.find((role) => role.key === "WAREHOUSE")!;
    expect(warehouse.permissions).toContain("warehouses.view");
    expect(warehouse.permissions).not.toContain("warehouses.manage");
    expect(warehouse.permissions).not.toContain("categories.manage");
    expect(warehouse.permissions).not.toContain("attributes.manage");
  });

  it("SALES_REPRESENTATIVE and ACCOUNTANT receive no new catalog-editing permissions", () => {
    const sales = ROLE_DEFINITIONS.find((role) => role.key === "SALES_REPRESENTATIVE")!;
    const accountant = ROLE_DEFINITIONS.find((role) => role.key === "ACCOUNTANT")!;
    for (const key of [
      "categories.manage",
      "brands.manage",
      "attributes.manage",
      "warehouses.manage",
      "product_images.manage",
      "product_imports.execute",
    ] as const) {
      expect(sales.permissions).not.toContain(key);
      expect(accountant.permissions).not.toContain(key);
    }
  });

  it("product_imports.execute is ADMIN-only", () => {
    for (const role of ROLE_DEFINITIONS) {
      if (role.key === "ADMIN") continue;
      expect(role.permissions).not.toContain("product_imports.execute");
    }
  });
});
