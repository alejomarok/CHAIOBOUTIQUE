"use client";

import { Menu, X } from "lucide-react";
import { useState } from "react";

import type { AdminNavGroup } from "@/components/layout/admin-nav-items";
import { AdminNavLinks } from "@/components/layout/admin-nav-links";
import { BackToStoreLink } from "@/components/layout/back-to-store-link";
import { Logo } from "@/components/layout/logo";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const brandClassName = "[&_span]:text-[15px] [&_span]:tracking-[0.06em] [&_img]:size-8";

export function AdminShell({
  groups,
  user,
  children,
}: {
  groups: AdminNavGroup[];
  user: { name: string; email: string };
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="bg-background flex min-h-svh">
      <a
        href="#admin-content"
        className="bg-foreground text-background sr-only z-50 rounded-md px-4 py-3 text-sm focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Ir al contenido
      </a>
      <aside className="border-border bg-background sticky top-0 hidden h-svh w-[244px] shrink-0 flex-col border-r min-[1100px]:flex">
        <div className="px-5 pt-7 pb-6">
          <Logo href="/" className={brandClassName} />
          <p className="text-muted-foreground mt-3 text-xs">Administración de la boutique</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
          <AdminNavLinks groups={groups} />
        </div>
        <div className="border-border border-t p-3">
          <BackToStoreLink />
          <div className="border-border mt-3 flex items-center gap-2 border-t px-2 pt-4 pb-1">
            <UserMenu name={user.name} email={user.email} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="text-muted-foreground truncate text-xs">{user.email}</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-border bg-background sticky top-0 z-30 flex h-16 items-center gap-3 border-b px-4 min-[1100px]:hidden">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-11 shrink-0"
                aria-label="Abrir menú de administración"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="left"
              showCloseButton={false}
              className="bg-background flex w-[min(340px,calc(100vw-24px))] flex-col gap-0 overflow-hidden p-0"
            >
              <SheetClose asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute top-3 right-3 size-11"
                  aria-label="Cerrar menú de administración"
                >
                  <X className="size-4" aria-hidden="true" />
                </Button>
              </SheetClose>
              <div className="px-5 pt-7 pb-6">
                <Logo href="/" className={brandClassName} />
                <SheetTitle className="mt-3 font-sans text-sm font-medium">
                  Administración
                </SheetTitle>
                <SheetDescription className="mt-1 text-xs">
                  Todo para gestionar tu boutique.
                </SheetDescription>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
                <AdminNavLinks groups={groups} onNavigate={() => setMobileNavOpen(false)} />
              </div>
              <div className="border-border border-t p-3 [&_a]:min-h-11">
                <BackToStoreLink onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <Logo
            compact
            className="min-w-0 flex-1 [&_span]:text-[13px] [&_span]:tracking-[0.04em]"
          />
          <UserMenu name={user.name} email={user.email} />
        </header>
        <main
          id="admin-content"
          tabIndex={-1}
          className="min-w-0 flex-1 p-4 outline-none min-[1100px]:p-8 sm:p-6"
        >
          <div className="mx-auto w-full max-w-[1440px]">{children}</div>
        </main>
      </div>
    </div>
  );
}
