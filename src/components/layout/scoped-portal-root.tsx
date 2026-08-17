"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// Radix Dialog/Sheet portals to document.body by default — a SIBLING of a
// theme-scoped wrapper (`.storefront` or `.admin`, see globals.css), not a
// descendant, so a scope's CSS custom-property overrides can never reach
// portaled content through the normal DOM cascade. This context exposes
// the scoped root's own DOM node so Sheet (the only portaled primitive
// either scope currently uses) can redirect its portal container into
// that subtree instead. Defaults to null — any consumer outside both
// providers falls back to Radix's default document.body portal,
// unchanged. One shared primitive for both scopes (not two copies) since
// the mechanism is identical; only the CSS class differs.
const PortalContainerContext = createContext<HTMLDivElement | null>(null);

export function usePortalContainer(): HTMLDivElement | null {
  return useContext(PortalContainerContext);
}

export function ScopedRoot({
  scopeClassName,
  className,
  children,
}: {
  scopeClassName: string;
  className?: string;
  children: ReactNode;
}) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);

  return (
    <PortalContainerContext.Provider value={node}>
      <div ref={setNode} className={`${scopeClassName} ${className ?? ""}`}>
        {children}
      </div>
    </PortalContainerContext.Provider>
  );
}
