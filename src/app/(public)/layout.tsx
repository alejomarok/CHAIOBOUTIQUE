import { PublicFooter } from "@/components/layout/public-footer";
import { PublicHeader } from "@/components/layout/public-header";
import { StorefrontRoot } from "@/components/layout/storefront-root";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <StorefrontRoot>
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </StorefrontRoot>
  );
}
