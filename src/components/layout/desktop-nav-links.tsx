"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

import type { NavLinkItem } from "@/components/layout/mobile-nav";

export function DesktopNavLinks({ navLinks }: { navLinks: NavLinkItem[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentUrl = searchParams.size > 0 ? `${pathname}?${searchParams.toString()}` : pathname;
  return (
    <ul className="flex items-center gap-3 text-[13px] xl:gap-6">
      {navLinks.map((link) => {
        const isActive = link.href === currentUrl;
        return (
          <li key={link.href} className="min-w-0">
            <Link
              href={link.href}
              title={link.label}
              aria-current={isActive ? "page" : undefined}
              className={`block max-w-40 truncate px-3 py-2 transition-colors ${isActive ? "text-primary font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
