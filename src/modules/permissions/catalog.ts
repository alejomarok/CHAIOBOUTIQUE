// Single source of truth for permission keys. The seed upserts these into the
// Permission table; requirePermission() checks against this union type, so a
// typo like "products.viewcost" is a compile-time error, not a silent no-op.
// Spanish labels are for the permissions admin UI (PERMISSIONS.md documents
// each key's intent in full).

export const PERMISSIONS = [
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
  "users.manage",
  "roles.manage",
  "settings.view",
  "settings.manage",
  "audit.view",

  // Phase 2 — catalog & inventory. products.*/stock.* keys above are Phase 1
  // and reused as-is; these are the new keys Phase 2 needs.
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
  "product_imports.execute",

  // Phase 3A — portal access. Distinct from any business-capability
  // permission (e.g. "sales.create"): these gate whether an account may
  // enter the /admin or /pos layout at all, never what it can do once
  // inside — see ARCHITECTURE.md and docs/adr/0003-customer-registration.md.
  // Never granted to CUSTOMER; every current staff role gets admin.access
  // (preserving today's "any staff login reaches /admin" behavior exactly,
  // now via an explicit, named, testable capability instead of an inferred
  // "not a customer" check).
  "admin.access",
  "pos.access",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

// Spanish labels for the admin permissions list (read-only in this phase).
export const PERMISSION_LABELS_ES: Record<Permission, string> = {
  "products.view": "Ver productos",
  "products.create": "Crear productos",
  "products.edit": "Editar productos",
  "products.delete": "Eliminar productos",
  "products.publish": "Publicar productos",
  "products.view_cost": "Ver costo de productos",
  "prices.view": "Ver precios",
  "prices.manage": "Gestionar precios",
  "stock.view": "Ver stock",
  "stock.adjust": "Ajustar stock",
  "stock.transfer": "Transferir stock entre depósitos",
  "stock.view_movements": "Ver movimientos de stock",
  "suppliers.view": "Ver proveedores",
  "suppliers.manage": "Gestionar proveedores",
  "purchases.view": "Ver compras",
  "purchases.create": "Crear compras",
  "purchases.receive": "Recibir compras",
  "purchases.cancel": "Cancelar compras",
  "customers.view": "Ver clientas",
  "customers.manage": "Gestionar clientas",
  "sales.create": "Crear ventas",
  "sales.view": "Ver ventas",
  "sales.cancel": "Cancelar ventas",
  "sales.refund": "Reembolsar ventas",
  "sales.apply_discount": "Aplicar descuentos",
  "cash_register.open": "Abrir caja",
  "cash_register.close": "Cerrar caja",
  "cash_register.view": "Ver caja",
  "expenses.view": "Ver gastos",
  "expenses.manage": "Gestionar gastos",
  "orders.view": "Ver pedidos",
  "orders.manage": "Gestionar pedidos",
  "shipments.view": "Ver envíos",
  "shipments.manage": "Gestionar envíos",
  "invoices.view": "Ver facturas",
  "invoices.issue": "Emitir facturas",
  "invoices.cancel": "Anular facturas",
  "reports.view": "Ver reportes",
  "reports.view_profit": "Ver rentabilidad",
  "users.view": "Ver usuarias",
  "users.manage": "Gestionar usuarias",
  "roles.manage": "Gestionar roles",
  "settings.view": "Ver configuración",
  "settings.manage": "Gestionar configuración",
  "audit.view": "Ver auditoría",

  "products.archive": "Archivar productos",
  "categories.view": "Ver categorías",
  "categories.manage": "Gestionar categorías",
  "brands.view": "Ver marcas",
  "brands.manage": "Gestionar marcas",
  "attributes.view": "Ver talles y colores",
  "attributes.manage": "Gestionar talles y colores",
  "warehouses.view": "Ver depósitos",
  "warehouses.manage": "Gestionar depósitos",
  "product_images.manage": "Gestionar imágenes de productos",
  "product_imports.view": "Ver importaciones",
  "product_imports.execute": "Ejecutar importaciones",

  "admin.access": "Acceder al panel de administración",
  "pos.access": "Acceder al punto de venta",
};
