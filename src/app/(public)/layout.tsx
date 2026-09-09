import { PublicFooter } from "@/components/layout/public-footer";
import { PublicHeader } from "@/components/layout/public-header";
import { StorefrontRoot } from "@/components/layout/storefront-root";

// Every route under (public) — /, /cart, /catalog, /product/[slug],
// /checkout — renders PublicHeader/PublicFooter, both of which read live
// StoreConfiguration/Category/StoreBranch data, and several of the pages
// themselves read Product/Cart data too. None of that is a good static-
// generation candidate (it's inherently per-request: cart cookies, live
// stock, admin-curated storefront config) — but without this, `next build`
// still executes these Server Components at least once during its own
// "Collecting/Generating static pages" phase to DECIDE whether a route is
// static or dynamic, which means a real Prisma query against whatever
// DATABASE_URL is configured (Supabase) every time `npm run build` runs,
// regardless of the final per-route verdict. `force-dynamic` here declares
// every route in this group dynamic upfront — Route Segment Config's
// documented, current mechanism for this project's caching model (no
// `cacheComponents` flag set; see node_modules/next/dist/docs/01-app/
// 02-guides/caching-without-cache-components.md) — so the build never
// executes this subtree's data fetching at all. Deliberately scoped to this
// one layout (inherited by every nested page, not applied per-page) rather
// than repeated across each route: the (auth) route group has its own,
// separate layout and is unaffected, and every /admin/* route already
// renders dynamically on its own (each calls requirePermission(), which
// touches cookies()/the session — a Request-time API Next's own heuristic
// already detects without an explicit flag).
export const dynamic = "force-dynamic";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <StorefrontRoot>
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </StorefrontRoot>
  );
}
