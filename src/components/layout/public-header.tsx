import Link from "next/link";

import { CartIconLink } from "@/components/layout/cart-icon-link";
import { DashboardLink } from "@/components/layout/dashboard-link";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { href: "/", label: "Inicio" },
  { href: "/catalog", label: "Catálogo" },
];

export function PublicHeader() {
  return (
    <header className="border-border bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Logo />
        <nav className="flex items-center gap-6">
          <ul className="hidden items-center gap-6 text-sm font-medium sm:flex">
            {NAV_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-foreground/80 hover:text-foreground">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
          <CartIconLink />
          <DashboardLink />
          <Button asChild variant="outline" size="sm">
            <Link href="/login">Iniciar sesión</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
