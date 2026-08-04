"use client";

import { Store } from "lucide-react";
import Link from "next/link";

// A dedicated, always-visible way out of the admin panel — distinct from
// the wordmark (which also goes to "/", see AdminShell) so there are two
// independent, discoverable paths back to the storefront. Deliberately a
// plain `Link` (client-side navigation, no sign-out) — the staff session
// stays intact; visiting "/" as a signed-in admin renders exactly like it
// would for any other visitor, nothing route-specific to authorize here.
// Same visual language as AdminNavLinks' inactive state — this link is
// never "active" (its href, "/", is outside every /admin/* route it could
// render from) so there is no active-state case to keep in sync.
export function BackToStoreLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/"
      onClick={onNavigate}
      className="text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
    >
      <Store className="size-4" />
      Volver a la tienda
    </Link>
  );
}
