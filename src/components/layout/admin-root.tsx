import type { ReactNode } from "react";

import { ScopedRoot } from "@/components/layout/scoped-portal-root";

// AdminShell (a direct child) already owns its own flex/min-h-svh layout
// div — this wrapper only ever applies the `.admin` theme scope + portal
// container, never a second competing layout container.
export function AdminRoot({ children }: { children: ReactNode }) {
  return (
    <ScopedRoot scopeClassName="admin" className="text-foreground bg-background">
      {children}
    </ScopedRoot>
  );
}
