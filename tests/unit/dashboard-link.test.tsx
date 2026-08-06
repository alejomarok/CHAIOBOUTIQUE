import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "@/modules/auth/session";

// Mocks the auth barrel entirely (never importOriginal on it) — that barrel
// re-exports from ./session, which imports "server-only"/next/headers and
// pulls in the real env/db config chain, none of which unit tests configure.
// resolvePostLoginDestination itself lives in ./post-login-redirect, a pure
// module with no such dependency, so it's safe to pull in for real — this
// exercises DashboardLink against the actual routing logic, not a re-implemented
// copy of it.
vi.mock("@/modules/auth", async () => {
  const { resolvePostLoginDestination } = await vi.importActual<
    typeof import("@/modules/auth/post-login-redirect")
  >("@/modules/auth/post-login-redirect");
  return {
    getCurrentUser: vi.fn(),
    resolvePostLoginDestination,
  };
});

const { getCurrentUser } = await import("@/modules/auth");
const { DashboardLink } = await import("@/components/layout/dashboard-link");

const mockedGetCurrentUser = vi.mocked(getCurrentUser);

function user(overrides: Partial<CurrentUser>): CurrentUser {
  return {
    id: "user-1",
    name: "Test User",
    email: "test@chaioboutique.local",
    emailVerified: true,
    roles: [],
    permissions: new Set(),
    ...overrides,
  };
}

describe("DashboardLink", () => {
  afterEach(cleanup);

  it("renders nothing for an anonymous visitor", async () => {
    mockedGetCurrentUser.mockResolvedValue(null);

    render(await DashboardLink());

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it('shows "Ir al panel" linking to /admin for an ADMIN with admin.access', async () => {
    mockedGetCurrentUser.mockResolvedValue(
      user({ roles: ["ADMIN"], permissions: new Set(["admin.access"]) }),
    );

    render(await DashboardLink());

    const link = screen.getByRole("link", { name: "Ir al panel" });
    expect(link).toHaveAttribute("href", "/admin");
  });

  it('shows "Ir al POS" linking to /pos for a POS-only user (pos.access, no admin.access)', async () => {
    mockedGetCurrentUser.mockResolvedValue(
      user({ roles: ["SALES_REPRESENTATIVE"], permissions: new Set(["pos.access"]) }),
    );

    render(await DashboardLink());

    const link = screen.getByRole("link", { name: "Ir al POS" });
    expect(link).toHaveAttribute("href", "/pos");
  });

  it("renders nothing for a CUSTOMER — never an admin/pos/account link", async () => {
    mockedGetCurrentUser.mockResolvedValue(user({ roles: ["CUSTOMER"], permissions: new Set() }));

    render(await DashboardLink());

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
