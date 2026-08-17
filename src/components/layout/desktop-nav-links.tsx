"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import type { NavLinkItem } from "@/components/layout/mobile-nav";

// Client-only for usePathname/useSearchParams (needed to compute the
// active link) — the rest of the header stays server-rendered. Compares
// the exact current URL (pathname + querystring) against each link's own
// href, so a category/sort link is only "active" for that exact filter,
// never a loose pathname-only match.
export function DesktopNavLinks({ navLinks }: { navLinks: NavLinkItem[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentUrl = searchParams.size > 0 ? `${pathname}?${searchParams.toString()}` : pathname;

  return (
    <ul className="flex items-center gap-1 text-sm font-medium">
      {navLinks.map((link) => {
        const isActive = link.href === currentUrl;
        return (
          <li key={link.href} className="min-w-0">
            {/* max-w + truncate: a safety net, not the primary defense —
                the primary defense is that these links are admin-curated
                (see public-header.tsx) — but an unexpectedly long category
                name must still never be able to stretch the header. */}
            <Link
              href={link.href}
              title={link.label}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "bg-blush text-foreground block max-w-32 truncate rounded-full px-3.5 py-2 font-semibold"
                  : "text-foreground/70 hover:text-foreground hover:bg-blush/60 block max-w-32 truncate rounded-full px-3.5 py-2 transition-colors"
              }
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
