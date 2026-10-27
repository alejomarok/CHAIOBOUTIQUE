import { Search } from "lucide-react";
import Link from "next/link";

import { AuthActions } from "@/components/layout/auth-actions";
import { CartIconLink } from "@/components/layout/cart-icon-link";
import { DashboardLink } from "@/components/layout/dashboard-link";
import { DesktopNavLinks } from "@/components/layout/desktop-nav-links";
import { Logo } from "@/components/layout/logo";
import { MobileNav, type NavLinkItem } from "@/components/layout/mobile-nav";
import { listStorefrontNavCategories } from "@/modules/categories/service";

export async function PublicHeader() {
  const categories = await listStorefrontNavCategories();
  const navLinks: NavLinkItem[] = [
    { href: "/", label: "Inicio" },
    { href: "/catalog?sort=newest", label: "Novedades" },
    ...categories
      .slice(0, 4)
      .map((category) => ({ href: `/catalog?category=${category.id}`, label: category.name })),
    { href: "/catalog", label: "Toda la colección" },
  ];

  return (
    <>
      <div className="flex min-h-11 flex-wrap items-center justify-center gap-x-8 bg-[#34483d] px-4 text-center text-sm text-[#fafbf7]">
        <span className="hidden sm:inline">Un estilo propio. Una forma de ser vos.</span>
        <Link
          href="/arrepentimiento"
          className="inline-flex min-h-11 items-center underline underline-offset-4"
        >
          Botón de arrepentimiento
        </Link>
      </div>
      <header className="store-header bg-background sticky top-0 z-40">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-10 lg:px-16">
          <div className="grid h-18 grid-cols-[44px_1fr_44px] items-center lg:hidden">
            <MobileNav
              navLinks={navLinks}
              authSlot={<AuthActions />}
              dashboardSlot={<DashboardLink />}
            />
            <div className="justify-self-center">
              <Logo compact />
            </div>
            <div className="justify-self-end">
              <CartIconLink />
            </div>
          </div>
          <div className="hidden h-24 grid-cols-[1fr_auto_1fr] items-center gap-6 lg:grid">
            <form
              action="/catalog"
              method="GET"
              role="search"
              className="flex max-w-[230px] items-center gap-3"
            >
              <button
                type="submit"
                aria-label="Buscar productos"
                className="hover:bg-muted inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-colors"
              >
                <Search className="size-[18px]" aria-hidden="true" />
              </button>
              <input
                name="q"
                type="search"
                placeholder="¿Qué estás buscando?"
                aria-label="Buscar productos"
                autoComplete="off"
                className="placeholder:text-muted-foreground w-full min-w-0 bg-transparent py-3 text-[13px]"
              />
            </form>
            <Logo />
            <div className="flex items-center justify-end gap-3 [&_[data-slot=button]]:min-h-11 [&_[data-slot=button]]:border-0 [&_[data-slot=button]]:bg-transparent [&_[data-slot=button]]:text-[13px] [&_[data-slot=button]]:shadow-none">
              <AuthActions />
              <DashboardLink />
              <CartIconLink />
            </div>
          </div>
          <nav aria-label="Navegación principal" className="hidden justify-center pb-4 lg:flex">
            <DesktopNavLinks navLinks={navLinks} />
          </nav>
        </div>
      </header>
    </>
  );
}
