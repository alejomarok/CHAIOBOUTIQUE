import Link from "next/link";

import { cn } from "@/lib/utils";

// Temporary typographic wordmark — no definitive logo has been designed yet.
export function Logo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link href={href} className={cn("font-heading text-xl font-semibold tracking-wide", className)}>
      CHAIOBOUTIQUE
    </Link>
  );
}
