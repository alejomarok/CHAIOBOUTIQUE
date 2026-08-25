import { Search } from "lucide-react";

import { AuthActions } from "@/components/layout/auth-actions";
import { CartIconLink } from "@/components/layout/cart-icon-link";
import { DashboardLink } from "@/components/layout/dashboard-link";
import { DesktopNavLinks } from "@/components/layout/desktop-nav-links";
import { Logo } from "@/components/layout/logo";
import { MobileNav, type NavLinkItem } from "@/components/layout/mobile-nav";
import { Input } from "@/components/ui/input";
import { listStorefrontNavCategories } from "@/modules/categories/service";

const STATIC_LINKS_BEFORE: NavLinkItem[] = [{ href: "/", label: "Inicio" }];
const STATIC_LINKS_AFTER: NavLinkItem[] = [{ href: "/catalog?sort=newest", label: "Novedades" }];
const MAX_CATEGORY_LINKS = 4;

async function getNavLinks(): Promise<NavLinkItem[]> {
  const categories = await listStorefrontNavCategories();
  const topLevel = categories
    .slice(0, MAX_CATEGORY_LINKS)
    .map((category) => ({ href: `/catalog?category=${category.id}`, label: category.name }));

  return [...STATIC_LINKS_BEFORE, ...STATIC_LINKS_AFTER, ...topLevel, { href: "/catalog", label: "Catálogo" }];
}

export async function PublicHeader() {
  const navLinks = await getNavLinks();

  return (
    <>
      <div className="bg-[#2f2a27] px-4 py-2 text-center text-[10px] font-medium uppercase tracking-[0.16em] text-white/90 sm:text-[11px]">
        Moda femenina · Comprá online · Atención personalizada
      </div>

      <header className="sticky top-0 z-40 border-b border-[#eadfd8] bg-[#fffdfb]/92 backdrop-blur-xl">
        <div className="mx-auto max-w-[1380px] px-4 sm:px-6 lg:px-10">
          <div className="grid h-16 grid-cols-[auto_1fr_auto] items-center lg:hidden">
            <div className="justify-self-start">
              <MobileNav navLinks={navLinks} authSlot={<AuthActions />} dashboardSlot={<DashboardLink />} />
            </div>
            <div className="justify-self-center">
              <Logo compact />
            </div>
            <div className="justify-self-end">
              <CartIconLink />
            </div>
          </div>

          <div className="hidden h-[76px] grid-cols-[auto_1fr_auto] items-center gap-7 lg:grid">
            <div className="justify-self-start">
              <Logo />
            </div>

            <div className="justify-self-center">
              <DesktopNavLinks navLinks={navLinks} />
            </div>

            <div className="flex items-center gap-1.5 justify-self-end">
              <form action="/catalog" method="GET" className="relative flex items-center">
                <Search
                  className="pointer-events-none absolute left-3 size-4 text-[#8c817b]"
                  aria-hidden="true"
                />
                <Input
                  name="q"
                  type="search"
                  placeholder="Buscar"
                  aria-label="Buscar productos"
                  className="h-9 w-36 rounded-full border-[#eadfd8] bg-[#fff8f4] pl-9 text-sm transition-[width,background-color] focus-visible:w-52 focus-visible:bg-white"
                />
              </form>
              <CartIconLink />
              <DashboardLink />
              <AuthActions />
            </div>
          </div>
        </div>
      </header>
    </>
  );
}
