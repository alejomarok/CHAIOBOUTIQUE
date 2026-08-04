"use client";

import { Menu } from "lucide-react";
import { useState } from "react";

import type { AdminNavItem } from "@/components/layout/admin-nav-items";
import { AdminNavLinks } from "@/components/layout/admin-nav-links";
import { BackToStoreLink } from "@/components/layout/back-to-store-link";
import { Logo } from "@/components/layout/logo";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

export function AdminShell({
  items,
  user,
  children,
}: {
  items: AdminNavItem[];
  user: { name: string; email: string };
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="flex min-h-svh">
      <aside className="bg-sidebar border-sidebar-border hidden w-64 shrink-0 flex-col gap-6 border-r p-4 md:flex">
        {/* The wordmark itself always leads back to the public storefront —
            "/admin" is one click away via the "Panel" nav item below, never
            the other way around. See AdminNavLinks/ADMIN_NAV_ITEMS. */}
        <Logo href="/" className="px-2" />
        <AdminNavLinks items={items} />
        <div className="border-sidebar-border mt-auto border-t pt-4">
          <BackToStoreLink />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-background/95 sticky top-0 z-30 flex h-16 items-center gap-4 border-b px-4 backdrop-blur sm:px-6">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild className="md:hidden">
              <Button variant="ghost" size="icon">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="flex w-64 flex-col p-4">
              <SheetTitle className="sr-only">Menú</SheetTitle>
              <Logo href="/" className="mb-6 px-2" />
              <AdminNavLinks items={items} onNavigate={() => setMobileNavOpen(false)} />
              <div className="border-sidebar-border mt-auto border-t pt-4">
                <BackToStoreLink onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <div className="flex-1" />
          <UserMenu name={user.name} email={user.email} />
        </header>
        <main className="flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
