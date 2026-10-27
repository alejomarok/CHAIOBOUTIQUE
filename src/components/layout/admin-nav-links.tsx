"use client";

import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  ClipboardList,
  Contact,
  KeyRound,
  LayoutDashboard,
  Package,
  Palette,
  Ruler,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Tags,
  Upload,
  Users,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

import type { AdminIconName, AdminNavGroup } from "@/components/layout/admin-nav-items";
import { cn } from "@/lib/utils";

// Lucide icon components are resolved here, client-side, from the plain
// iconName string the server sent — never passed as a component/function
// prop across the Server → Client boundary. See admin-nav-items.ts.
const ICON_MAP: Record<AdminIconName, ComponentType<{ className?: string }>> = {
  "layout-dashboard": LayoutDashboard,
  package: Package,
  tags: Tags,
  "shield-check": ShieldCheck,
  ruler: Ruler,
  palette: Palette,
  warehouse: Warehouse,
  boxes: Boxes,
  "sliders-horizontal": SlidersHorizontal,
  "arrow-left-right": ArrowLeftRight,
  upload: Upload,
  users: Users,
  "key-round": KeyRound,
  settings: Settings,
  contact: Contact,
  "shopping-cart": ShoppingCart,
  "clipboard-list": ClipboardList,
  "bar-chart-3": BarChart3,
};

export function AdminNavLinks({
  groups,
  onNavigate,
}: {
  groups: AdminNavGroup[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  // The longest matching destination owns nested detail/edit screens.
  // Inventory's own subpages must not also activate its parent link.
  const activeHref = groups
    .flatMap((group) => group.items)
    .filter(
      (item) =>
        pathname === item.href || (item.href !== "/admin" && pathname.startsWith(`${item.href}/`)),
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  return (
    <nav aria-label="Navegación de administración" className="flex flex-col gap-6">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="text-muted-foreground mb-1.5 px-3 text-xs font-medium">{group.label}</p>
          {group.items.map((item) => {
            const isActive = activeHref === item.href;
            const Icon = ICON_MAP[item.iconName];
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "focus-visible:ring-ring flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-offset-2 min-[1100px]:min-h-9 min-[1100px]:py-1.5",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
