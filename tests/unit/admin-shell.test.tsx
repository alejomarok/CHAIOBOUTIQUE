import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin",
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

const { AdminShell } = await import("@/components/layout/admin-shell");

describe("AdminShell", () => {
  afterEach(cleanup);

  const items = [
    { href: "/admin", label: "Panel", iconName: "layout-dashboard" as const },
  ];
  const user = { name: "Admin Test", email: "admin@chaioboutique.local" };

  it("points every wordmark instance back to the public storefront, never to /admin", () => {
    render(
      <AdminShell items={items} user={user}>
        <div>content</div>
      </AdminShell>,
    );

    const wordmarks = screen.getAllByRole("link", { name: "CHAIOBOUTIQUE" });
    expect(wordmarks.length).toBeGreaterThan(0);
    for (const wordmark of wordmarks) {
      expect(wordmark).toHaveAttribute("href", "/");
    }
  });

  it('renders a "Volver a la tienda" action that also points to /', () => {
    render(
      <AdminShell items={items} user={user}>
        <div>content</div>
      </AdminShell>,
    );

    const backLinks = screen.getAllByRole("link", { name: /Volver a la tienda/i });
    expect(backLinks.length).toBeGreaterThan(0);
    for (const link of backLinks) {
      expect(link).toHaveAttribute("href", "/");
    }
  });

  it("preserves active-nav styling on the current admin route", () => {
    render(
      <AdminShell items={items} user={user}>
        <div>content</div>
      </AdminShell>,
    );

    const panelLinks = screen.getAllByRole("link", { name: /Panel/i });
    expect(panelLinks.length).toBeGreaterThan(0);
    for (const link of panelLinks) {
      expect(link.className).toContain("bg-sidebar-primary");
    }
  });
});
