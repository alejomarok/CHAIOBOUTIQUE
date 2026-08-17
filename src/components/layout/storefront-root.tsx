import type { ReactNode } from "react";

import { ScopedRoot } from "@/components/layout/scoped-portal-root";

export function StorefrontRoot({ children }: { children: ReactNode }) {
  return (
    <ScopedRoot scopeClassName="storefront" className="bg-background text-foreground flex min-h-full flex-1 flex-col">
      {children}
    </ScopedRoot>
  );
}
