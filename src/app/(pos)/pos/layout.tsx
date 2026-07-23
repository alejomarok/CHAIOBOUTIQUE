import { Logo } from "@/components/layout/logo";
import { UserMenu } from "@/components/layout/user-menu";
import { requirePermission } from "@/modules/auth";

// Deliberately not the admin sidebar shell: the point-of-sale UI needs to be
// fast, simple, and usable by staff without technical knowledge — its own
// layout is built out when the POS module itself is implemented.
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePermission("sales.create");

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-border bg-background flex h-16 items-center justify-between border-b px-4 sm:px-6">
        <Logo href="/pos" />
        <UserMenu name={user.name} email={user.email} />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
