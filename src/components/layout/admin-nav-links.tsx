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

  return (
    <nav className="flex flex-col gap-5">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="text-sidebar-foreground/55 px-3 text-xs font-semibold tracking-[0.1em] uppercase">
            {group.label}
          </p>
          {group.items.map((item) => {
            const isActive = pathname === item.href;
            const Icon = ICON_MAP[item.iconName];
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
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
        </div>
      ))}
    </nav>
  );
}
