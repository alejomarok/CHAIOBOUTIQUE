"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// Radix Dialog/Sheet portals to document.body by default — a SIBLING of
// the `.storefront` wrapper below, not a descendant, so the storefront's
// scoped CSS custom-property overrides (see globals.css's `.storefront`
// block) can never reach portaled content through the normal DOM cascade.
// This context exposes the storefront root DOM node so Sheet (the only
// portaled primitive the storefront currently uses) can redirect its
// portal container into that subtree instead. Defaults to null — any
// consumer outside this provider (i.e. admin) falls back to Radix's
// default document.body portal, unchanged.
const StorefrontPortalContext = createContext<HTMLDivElement | null>(null);

export function useStorefrontPortalContainer(): HTMLDivElement | null {
  return useContext(StorefrontPortalContext);
}

export function StorefrontRoot({ children }: { children: ReactNode }) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  return (
    <StorefrontPortalContext.Provider value={node}>
      <div ref={setNode} className="storefront bg-background text-foreground flex min-h-full flex-1 flex-col">
        {children}
      </div>
    </StorefrontPortalContext.Provider>
  );
}
