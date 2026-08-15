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
          <li key={link.href}>
            <Link
              href={link.href}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "bg-blush text-foreground rounded-full px-3.5 py-2 font-semibold whitespace-nowrap"
                  : "text-foreground/70 hover:text-foreground hover:bg-blush/60 rounded-full px-3.5 py-2 whitespace-nowrap transition-colors"
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
