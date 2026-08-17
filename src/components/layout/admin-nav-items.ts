import type { Permission } from "@/modules/permissions/catalog";

// Deliberately plain, JSON-serializable data — no lucide-react import here.
// This module is consumed by (admin)/admin/layout.tsx, a Server Component,
// and its output crosses into AdminShell/AdminNavLinks, Client Components —
// a React component reference (a function) can't cross that boundary ("Only
// plain objects can be passed to Client Components"). iconName is resolved
// to an actual Lucide icon only inside admin-nav-links.tsx (client-side),
// via ICON_MAP — see that file.
export type AdminIconName =
  | "layout-dashboard"
  | "package"
  | "tags"
  | "shield-check"
  | "ruler"
  | "palette"
  | "warehouse"
  | "boxes"
  | "sliders-horizontal"
  | "arrow-left-right"
  | "upload"
  | "users"
  | "key-round"
  | "settings"
  | "contact"
  | "shopping-cart";

export interface AdminNavItem {
  href: string;
  label: string;
  iconName: AdminIconName;
  permission?: Permission;
}

// Also reused, unchanged, for the permission-filtered shape actually
// rendered — see (admin)/admin/layout.tsx, which maps ADMIN_NAV_GROUPS's
// `items` down per the current user's permissions before handing the
// result to the Client Component tree (AdminShell/AdminNavLinks). A group
// with zero visible items after filtering is dropped entirely there,
// never rendered as an empty section header.
export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

// Undefined permission = visible to any authenticated staff user (only
// Dashboard). Every other item is filtered server-side in
// (admin)/admin/layout.tsx against the current user's actual permissions —
// this list only controls what's *offered* in the UI, not what's allowed;
// every page re-checks its own permission on the server regardless.
// "Mi perfil" deliberately isn't here — it lives in UserMenu (the account
// dropdown), not the business-module sidebar; the sidebar's job is
// operational modules, grouped the way the business actually thinks about
// them, not every route that happens to live under /admin.
export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    label: "General",
    items: [{ href: "/admin", label: "Panel", iconName: "layout-dashboard" }],
  },
  {
    label: "Catálogo",
    items: [
      { href: "/admin/products", label: "Productos", iconName: "package", permission: "products.view" },
      { href: "/admin/categories", label: "Categorías", iconName: "tags", permission: "categories.view" },
      { href: "/admin/brands", label: "Marcas", iconName: "shield-check", permission: "brands.view" },
      { href: "/admin/colors", label: "Colores", iconName: "palette", permission: "attributes.view" },
      {
        href: "/admin/size-groups",
        label: "Grupos de talles",
        iconName: "ruler",
        permission: "attributes.view",
      },
      {
        href: "/admin/imports/products",
        label: "Importaciones",
        iconName: "upload",
        permission: "product_imports.view",
      },
    ],
  },
  {
    label: "Inventario",
    items: [
      { href: "/admin/inventory", label: "Inventario", iconName: "boxes", permission: "stock.view" },
      {
        href: "/admin/inventory/adjustments",
        label: "Ajustes",
        iconName: "sliders-horizontal",
        permission: "stock.adjust",
      },
      {
        href: "/admin/inventory/movements",
        label: "Movimientos",
        iconName: "arrow-left-right",
        permission: "stock.view_movements",
      },
      { href: "/admin/warehouses", label: "Depósitos", iconName: "warehouse", permission: "warehouses.view" },
    ],
  },
  {
    label: "Comercial",
    items: [
      { href: "/admin/customers", label: "Clientes", iconName: "contact", permission: "customers.view" },
      { href: "/admin/sales", label: "Ventas", iconName: "shopping-cart", permission: "sales.view" },
    ],
  },
  {
    label: "Administración",
    items: [
      { href: "/admin/users", label: "Usuarias", iconName: "users", permission: "users.view" },
      { href: "/admin/roles", label: "Roles", iconName: "shield-check", permission: "roles.manage" },
      { href: "/admin/permissions", label: "Permisos", iconName: "key-round", permission: "roles.manage" },
      { href: "/admin/settings", label: "Configuración", iconName: "settings", permission: "settings.view" },
    ],
  },
];
