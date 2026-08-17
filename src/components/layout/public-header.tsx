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
const MAX_CATEGORY_LINKS = 5;

// Category links come from listStorefrontNavCategories — categories an
// admin has explicitly opted into the public nav (Category.
// showInStorefrontNav), never a raw dump of every active category. A
// category left at its default (not opted in) — internal, QA, an import
// staging run, anything not deliberately curated — can never appear here,
// regardless of how many real products it has. See that function's doc
// comment and prisma/schema.prisma's field comment for the full rule.
// "Ofertas" is deliberately omitted: there is no working "on sale"
// filter/route yet, and a nav item with nowhere real to go is exactly the
// "dead link" this phase asks to avoid. Sales/POS/Inventory/Customers are
// never candidates here at all — those are administrative concepts with
// no public route; this function only ever reads Category rows.
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
    <header className="border-border bg-background/95 supports-backdrop-filter:bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Mobile row (< lg): hamburger — centered compact logo — cart.
            A deliberately distinct layout from desktop, not a squashed
            version of it — see requirement #4. */}
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

        {/* Desktop row (>= lg): logo — centered primary nav — search/cart/
            account. A 3-column grid (not flex-1 centering) so the nav is
            genuinely centered in the header regardless of how wide the
            logo or the right-hand actions are. */}
        <div className="hidden h-18 grid-cols-[auto_1fr_auto] items-center gap-6 lg:grid">
          <div className="justify-self-start">
            <Logo />
          </div>
          <div className="justify-self-center">
            <DesktopNavLinks navLinks={navLinks} />
          </div>
          <div className="flex items-center gap-2 justify-self-end">
            <form action="/catalog" method="GET" className="relative flex items-center">
              <Search
                className="text-muted-foreground pointer-events-none absolute left-2.5 size-4"
                aria-hidden="true"
              />
              <Input
                name="q"
                type="search"
                placeholder="Buscar…"
                aria-label="Buscar productos"
                className="bg-blush/60 h-8 w-36 border-transparent pl-8 focus-visible:w-52"
              />
            </form>
            <CartIconLink />
            <DashboardLink />
            <AuthActions />
          </div>
        </div>
      </div>
    </header>
  );
}
