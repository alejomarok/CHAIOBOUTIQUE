import { Logo } from "@/components/layout/logo";
import { UserMenu } from "@/components/layout/user-menu";
import { requirePermission } from "@/modules/auth";

// Deliberately not the admin sidebar shell: the point-of-sale UI needs to be
// fast, simple, and usable by staff without technical knowledge — its own
// layout is built out when the POS module itself is implemented.
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  // pos.access (portal access) rather than sales.create (a business
  // capability) — separates "can enter this portal" from "can perform this
  // action once inside," the same split admin.access makes for /admin. Both
  // roles that hold sales.create today (MANAGER, SALES_REPRESENTATIVE) also
  // hold pos.access, so this changes nothing about who reaches /pos.
  const user = await requirePermission("pos.access");

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
