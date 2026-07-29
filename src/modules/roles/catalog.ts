import type { Permission } from "@/modules/permissions/catalog";
import { PERMISSIONS } from "@/modules/permissions/catalog";

// The 6 system roles and their permission sets, per the responsibilities the
// business defined (see PERMISSIONS.md for the full rationale behind each
// inclusion/exclusion — these are least-privilege defaults, adjustable later
// through per-user overrides once that architecture exists).
export interface RoleDefinition {
  key: string;
  /** English, code-facing only — not persisted. */
  name: string;
  /** Persisted as Role.name: the interface is Spanish-facing. */
  nameEs: string;
  /** English, code-facing only — not persisted. */
  description: string;
  /** Persisted as Role.description. */
  descriptionEs: string;
  permissions: readonly Permission[];
}

const MANAGER_PERMISSIONS: Permission[] = [
  "products.view",
  "products.create",
  "products.edit",
  "products.delete",
  "products.publish",
  "products.view_cost",
  "prices.view",
  "prices.manage",
  "stock.view",
  "stock.adjust",
  "stock.transfer",
  "stock.view_movements",
  "suppliers.view",
  "suppliers.manage",
  "purchases.view",
  "purchases.create",
  "purchases.receive",
  "purchases.cancel",
  "customers.view",
  "customers.manage",
  "sales.create",
  "sales.view",
  "sales.cancel",
  "sales.refund",
  "sales.apply_discount",
  "cash_register.open",
  "cash_register.close",
  "cash_register.view",
  "expenses.view",
  "expenses.manage",
  "orders.view",
  "orders.manage",
  "shipments.view",
  "shipments.manage",
  "invoices.view",
  "invoices.issue",
  "invoices.cancel",
  "reports.view",
  "reports.view_profit",
  "users.view",
  "settings.view",

  // Phase 2 — catalog & inventory. product_imports.execute deliberately
  // excluded: a bulk import can rewrite pricing/stock across many rows at
  // once, a different risk class than day-to-day operations — ADMIN only,
  // a reversible least-privilege default like the rest of this list.
  "products.archive",
  "categories.view",
  "categories.manage",
  "brands.view",
  "brands.manage",
  "attributes.view",
  "attributes.manage",
  "warehouses.view",
  "warehouses.manage",
  "product_images.manage",
  "product_imports.view",

  // Phase 3A — portal access. MANAGER already reaches /admin and /pos today
  // (via the permission set above); these make that explicit rather than
  // inferred. See modules/permissions/catalog.ts.
  "admin.access",
  "pos.access",
];

// Explicit spec: can sell, search products/stock, manage customers, process
// authorized exchanges, prepare online orders, send receipts, view own sales,
// apply discounts. Cannot view costs/profits, manage users/roles, touch
// fiscal config, or delete completed sales.
const SALES_REPRESENTATIVE_PERMISSIONS: Permission[] = [
  "products.view",
  "prices.view",
  "stock.view",
  "customers.view",
  "customers.manage",
  "sales.create",
  "sales.view",
  "sales.refund",
  "sales.apply_discount",
  "cash_register.open",
  "cash_register.close",
  "cash_register.view",
  "orders.view",
  "orders.manage",
  "shipments.view",
  "invoices.view",
  "invoices.issue",

  // Phase 3A — portal access, same reasoning as MANAGER above.
  "admin.access",
  "pos.access",
];

// Explicit spec: reception, movements, adjustments, order/shipment
// preparation, warehouse transfers. No profitability access.
const WAREHOUSE_PERMISSIONS: Permission[] = [
  "products.view",
  "stock.view",
  "stock.adjust",
  "stock.transfer",
  "stock.view_movements",
  "suppliers.view",
  "purchases.view",
  "purchases.receive",
  "orders.view",
  "orders.manage",
  "shipments.view",
  "shipments.manage",

  // Phase 2: needs to pick a warehouse when adjusting/transferring stock.
  // Not warehouses.manage (creating/editing warehouse entities) or
  // attributes.*/categories.* (catalog curation, not operational stock data).
  "warehouses.view",

  // Phase 3A — portal access: WAREHOUSE already uses /admin (inventory,
  // warehouses) today, but never /pos (doesn't sell).
  "admin.access",
];

// Explicit spec: invoices, credit notes, taxes, sales/purchase reports,
// expenses, financial exports, fiscal config "when authorized" (not granted
// by default — see settings.manage note below).
const ACCOUNTANT_PERMISSIONS: Permission[] = [
  "products.view",
  "products.view_cost",
  "prices.view",
  "suppliers.view",
  "purchases.view",
  "customers.view",
  "sales.view",
  "cash_register.view",
  "expenses.view",
  "expenses.manage",
  "invoices.view",
  "invoices.issue",
  "invoices.cancel",
  "reports.view",
  "reports.view_profit",
  "settings.view",

  // Phase 3A — portal access: ACCOUNTANT already uses /admin (settings,
  // invoices, reports) today, never /pos.
  "admin.access",
];

export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    key: "ADMIN",
    name: "Administrator",
    nameEs: "Administradora",
    description: "Full access to every module, including users, roles, settings and audit logs.",
    descriptionEs:
      "Acceso completo a todos los módulos, incluyendo usuarias, roles, configuración y auditoría.",
    permissions: PERMISSIONS,
  },
  {
    key: "MANAGER",
    name: "Manager",
    nameEs: "Encargada",
    description:
      "Manages daily store operations. Excludes user/role management, system settings and audit logs.",
    descriptionEs:
      "Gestiona la operación diaria de la tienda. No incluye gestión de usuarias/roles, configuración del sistema ni auditoría.",
    permissions: MANAGER_PERMISSIONS,
  },
  {
    key: "SALES_REPRESENTATIVE",
    name: "Sales Representative",
    nameEs: "Vendedora",
    description:
      "Sells in-store, manages customers, prepares online orders. No cost/profit visibility.",
    descriptionEs:
      "Vende en el local, gestiona clientas y prepara pedidos online. Sin visibilidad de costos ni rentabilidad.",
    permissions: SALES_REPRESENTATIVE_PERMISSIONS,
  },
  {
    key: "WAREHOUSE",
    name: "Warehouse",
    nameEs: "Depósito",
    description: "Inventory reception, movements, adjustments, order and shipment preparation.",
    descriptionEs:
      "Recepción de mercadería, movimientos y ajustes de stock, preparación de pedidos y envíos.",
    permissions: WAREHOUSE_PERMISSIONS,
  },
  {
    key: "ACCOUNTANT",
    name: "Accountant",
    nameEs: "Contadora",
    description: "Invoicing, taxes, expenses, financial reports and exports.",
    descriptionEs: "Facturación, impuestos, gastos, reportes financieros y exportaciones.",
    permissions: ACCOUNTANT_PERMISSIONS,
  },
  {
    key: "CUSTOMER",
    name: "Customer",
    nameEs: "Cliente",
    // Deliberately empty: customer-facing access (own profile/orders/
    // invoices/shipments/favorites) is authorized by entity ownership
    // (userId === self), not by this admin/POS permission catalog.
    description: "Storefront customer. Access is scoped to their own data, not by permission keys.",
    descriptionEs:
      "Clienta de la tienda. El acceso se limita a sus propios datos, no por permisos.",
    permissions: [],
  },
];
