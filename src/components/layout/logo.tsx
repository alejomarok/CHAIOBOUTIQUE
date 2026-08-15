import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

// The real CHAIOBOUTIQUE bird mark (public/images/logo.png, transparent
// background, 1254x1254) — shared between admin and the storefront (see
// components/layout/admin-shell.tsx and public-header.tsx). Fixed
// width/height (not `fill`) preserves its exact aspect ratio, so it's
// never stretched. `alt=""` — the mark is paired with a visible
// "CHAIOBOUTIQUE" text label right next to it, which alone carries the
// link's accessible name; giving the image its own alt text would just
// duplicate that name for every screen-reader user. `compact` is for
// tight spaces (the mobile header's centered slot).
export function Logo({
  className,
  href = "/",
  compact = false,
}: {
  className?: string;
  href?: string;
  compact?: boolean;
}) {
  const iconSize = compact ? 26 : 34;

  return (
    <Link href={href} className={cn("inline-flex items-center gap-2", className)}>
      <Image
        src="/images/logo.png"
        alt=""
        width={iconSize}
        height={iconSize}
        priority
        className="shrink-0"
      />
      <span
        className={cn("font-heading font-semibold tracking-wide", compact ? "text-lg" : "text-xl")}
      >
        CHAIOBOUTIQUE
      </span>
    </Link>
  );
}
