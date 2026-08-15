"use client";

import { Menu, Search } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export interface NavLinkItem {
  href: string;
  label: string;
}

// The first two entries (Inicio, Novedades) and the last (Catálogo) are
// always-present store links; everything in between is real, dynamic
// category links — see public-header.tsx's getNavLinks. Splitting them
// here is purely presentational (a "Categorías" section label), not a
// second source of truth.
function splitNavLinks(navLinks: NavLinkItem[]) {
  const storeLinks = navLinks.slice(0, 2);
  const categoryLinks = navLinks.slice(2, -1);
  const catalogLink = navLinks[navLinks.length - 1];
  return { storeLinks, categoryLinks, catalogLink };
}

export function MobileNav({
  navLinks,
  authSlot,
  dashboardSlot,
}: {
  navLinks: NavLinkItem[];
  authSlot: ReactNode;
  dashboardSlot: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { storeLinks, categoryLinks, catalogLink } = splitNavLinks(navLinks);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Abrir menú">
          <Menu className="size-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="flex w-4/5 flex-col gap-0 p-0 sm:max-w-xs">
        <SheetHeader className="border-border border-b">
          <SheetTitle>Menú</SheetTitle>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-7 overflow-y-auto p-4">
          <form action="/catalog" method="GET" className="flex items-center gap-2">
            <Search className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
            <Input
              name="q"
              type="search"
              placeholder="Buscar productos"
              aria-label="Buscar productos"
              className="h-9"
            />
          </form>

          <nav aria-label="Navegación principal" className="flex flex-col gap-5">
            <ul className="flex flex-col gap-1">
              {[...storeLinks, catalogLink].map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="hover:bg-blush block rounded-lg px-3 py-2.5 text-base font-medium"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>

            {categoryLinks.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-muted-foreground px-3 text-xs font-semibold tracking-[0.12em] uppercase">
                  Categorías
                </p>
                <ul className="flex flex-col gap-1">
                  {categoryLinks.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        onClick={() => setOpen(false)}
                        className="hover:bg-blush block rounded-lg px-3 py-2.5 text-base font-medium"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </nav>

          <div className="border-border mt-auto flex flex-col gap-3 border-t pt-5" onClick={() => setOpen(false)}>
            {dashboardSlot}
            {authSlot}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
