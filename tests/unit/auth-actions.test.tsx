import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CurrentUser } from "@/modules/auth/session";

// Same reasoning as tests/unit/dashboard-link.test.tsx: mock the auth barrel
// entirely rather than importOriginal, since ./session pulls in
// "server-only"/next/headers/db config that a plain component unit test
// doesn't configure.
vi.mock("@/modules/auth", () => ({
  getCurrentUser: vi.fn(),
}));

// AuthActions renders <LogoutButton /> for the authenticated branch, which
// itself calls useRouter()/authClient at render time — both need mocking
// here too, same as tests/unit/logout-button.test.tsx.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: vi.fn() },
}));

const { getCurrentUser } = await import("@/modules/auth");
const { AuthActions } = await import("@/components/layout/auth-actions");

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

describe("AuthActions", () => {
  afterEach(cleanup);

  it('shows "Iniciar sesión" linking to /login for an anonymous visitor', async () => {
    mockedGetCurrentUser.mockResolvedValue(null);

    render(await AuthActions());

    const link = screen.getByRole("link", { name: "Iniciar sesión" });
    expect(link).toHaveAttribute("href", "/login");
  });

  it('never shows "Cerrar sesión" for an anonymous visitor', async () => {
    mockedGetCurrentUser.mockResolvedValue(null);

    render(await AuthActions());

    expect(screen.queryByText("Cerrar sesión")).not.toBeInTheDocument();
  });

  it('shows "Cerrar sesión" for an authenticated ADMIN', async () => {
    mockedGetCurrentUser.mockResolvedValue(
      user({ roles: ["ADMIN"], permissions: new Set(["admin.access"]) }),
    );

    render(await AuthActions());

    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it('never shows "Iniciar sesión" for an authenticated ADMIN', async () => {
    mockedGetCurrentUser.mockResolvedValue(
      user({ roles: ["ADMIN"], permissions: new Set(["admin.access"]) }),
    );

    render(await AuthActions());

    expect(screen.queryByRole("link", { name: "Iniciar sesión" })).not.toBeInTheDocument();
  });

  it('shows "Cerrar sesión" for an authenticated CUSTOMER, with no fake account link', async () => {
    mockedGetCurrentUser.mockResolvedValue(user({ roles: ["CUSTOMER"], permissions: new Set() }));

    render(await AuthActions());

    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Iniciar sesión" })).not.toBeInTheDocument();
  });
});
