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

  it("sales.record_payment/void_payment are granted to the roles that actually run POS (ADMIN, MANAGER, SALES_REPRESENTATIVE) and no one else", () => {
    for (const key of ["sales.record_payment", "sales.void_payment"] as const) {
      for (const roleKey of ["ADMIN", "MANAGER", "SALES_REPRESENTATIVE"]) {
        const role = ROLE_DEFINITIONS.find((r) => r.key === roleKey)!;
        expect(role.permissions, `${roleKey} should have "${key}"`).toContain(key);
      }
      for (const roleKey of ["WAREHOUSE", "ACCOUNTANT", "CUSTOMER"]) {
        const role = ROLE_DEFINITIONS.find((r) => r.key === roleKey)!;
        expect(role.permissions, `${roleKey} should NOT have "${key}"`).not.toContain(key);
      }
    }
  });

  it("orders.cancel mirrors sales.cancel's exact grant — ADMIN and MANAGER only", () => {
    for (const roleKey of ["ADMIN", "MANAGER"]) {
      const role = ROLE_DEFINITIONS.find((r) => r.key === roleKey)!;
      expect(role.permissions, `${roleKey} should have "orders.cancel"`).toContain("orders.cancel");
    }
    for (const roleKey of ["SALES_REPRESENTATIVE", "WAREHOUSE", "ACCOUNTANT", "CUSTOMER"]) {
      const role = ROLE_DEFINITIONS.find((r) => r.key === roleKey)!;
      expect(role.permissions, `${roleKey} should NOT have "orders.cancel"`).not.toContain("orders.cancel");
      // But orders.view/orders.manage are unaffected by this phase for the
      // roles that already had them (WAREHOUSE/SALES_REPRESENTATIVE) —
      // orders.cancel is strictly additive, never a replacement.
    }
    expect(
      ROLE_DEFINITIONS.find((r) => r.key === "WAREHOUSE")!.permissions,
    ).toContain("orders.manage");
  });

  // Phase — Fiscal Invoicing Foundation. invoices.view/issue/cancel already
  // existed in the catalog before this phase (reused unchanged, never
  // re-invented) — this asserts the exact role matrix this phase's fiscal
  // document workflow relies on: viewing fiscal data is separate from
  // registering/voiding it (invoices.issue vs invoices.cancel), and
  // CUSTOMER receives zero admin invoice permissions.
  it("invoices.view/issue are granted to ADMIN, MANAGER, SALES_REPRESENTATIVE, ACCOUNTANT", () => {
    for (const key of ["invoices.view", "invoices.issue"] as const) {
      for (const roleKey of ["ADMIN", "MANAGER", "SALES_REPRESENTATIVE", "ACCOUNTANT"]) {
        const role = ROLE_DEFINITIONS.find((r) => r.key === roleKey)!;
        expect(role.permissions, `${roleKey} should have "${key}"`).toContain(key);
      }
      for (const roleKey of ["WAREHOUSE", "CUSTOMER"]) {
        const role = ROLE_DEFINITIONS.find((r) => r.key === roleKey)!;
        expect(role.permissions, `${roleKey} should NOT have "${key}"`).not.toContain(key);
      }
    }
  });

  it("invoices.cancel (voiding a fiscal document) is stricter than invoices.issue — SALES_REPRESENTATIVE may register but not void", () => {
    for (const roleKey of ["ADMIN", "MANAGER", "ACCOUNTANT"]) {
      const role = ROLE_DEFINITIONS.find((r) => r.key === roleKey)!;
      expect(role.permissions, `${roleKey} should have "invoices.cancel"`).toContain(
        "invoices.cancel",
      );
    }
    for (const roleKey of ["SALES_REPRESENTATIVE", "WAREHOUSE", "CUSTOMER"]) {
      const role = ROLE_DEFINITIONS.find((r) => r.key === roleKey)!;
      expect(role.permissions, `${roleKey} should NOT have "invoices.cancel"`).not.toContain(
        "invoices.cancel",
      );
    }
  });

  it("CUSTOMER receives zero fiscal/invoicing permissions", () => {
    const customer = ROLE_DEFINITIONS.find((role) => role.key === "CUSTOMER")!;
    expect(customer.permissions).not.toContain("invoices.view");
    expect(customer.permissions).not.toContain("invoices.issue");
    expect(customer.permissions).not.toContain("invoices.cancel");
  });

  // Phase — ARCA Fiscal Readiness + Tax Model. The admin fiscal-settings
  // screen (Configuración → Datos fiscales, and the "Facturación
  // electrónica — ARCA" readiness card) is gated by settings.view/manage —
  // CUSTOMER must never reach either.
  it("CUSTOMER receives zero admin settings permissions — never reaches Configuración → Datos fiscales", () => {
    const customer = ROLE_DEFINITIONS.find((role) => role.key === "CUSTOMER")!;
    expect(customer.permissions).not.toContain("settings.view");
    expect(customer.permissions).not.toContain("settings.manage");
  });

  // Phase — Sales Consultation & Commercial Reporting. sales.view is the
  // ONE permission that gates /admin/sales/consultation (the same
  // permission the existing /admin/sales list already uses — this phase
  // deliberately reused it rather than introducing a new one; see this
  // phase's own final report). Confirms the exact role matrix the spec
  // requires: ADMIN (full), MANAGER, SALES_REPRESENTATIVE and ACCOUNTANT
  // can consult sales history; WAREHOUSE and CUSTOMER cannot.
  it("sales.view is granted to ADMIN, MANAGER, SALES_REPRESENTATIVE, ACCOUNTANT — never WAREHOUSE or CUSTOMER", () => {
    for (const roleKey of ["ADMIN", "MANAGER", "SALES_REPRESENTATIVE", "ACCOUNTANT"]) {
      const role = ROLE_DEFINITIONS.find((r) => r.key === roleKey)!;
      expect(role.permissions, `${roleKey} should have "sales.view"`).toContain("sales.view");
    }
    for (const roleKey of ["WAREHOUSE", "CUSTOMER"]) {
      const role = ROLE_DEFINITIONS.find((r) => r.key === roleKey)!;
      expect(role.permissions, `${roleKey} should NOT have "sales.view"`).not.toContain("sales.view");
    }
  });
});
