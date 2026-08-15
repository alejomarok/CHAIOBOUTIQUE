"use client";

import {
  Boxes,
  Contact,
  KeyRound,
  LayoutDashboard,
  Package,
  Palette,
  Ruler,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Tags,
  Upload,
  UserRound,
  Users,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";

import type { AdminIconName, AdminNavItem } from "@/components/layout/admin-nav-items";
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
  upload: Upload,
  users: Users,
  "key-round": KeyRound,
  settings: Settings,
  "user-round": UserRound,
  contact: Contact,
  "shopping-cart": ShoppingCart,
};

export function AdminNavLinks({
  items,
  onNavigate,
}: {
  items: AdminNavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1">
      {items.map((item) => {
        const isActive = pathname === item.href;
        const Icon = ICON_MAP[item.iconName];
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-primary text-sidebar-primary-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
