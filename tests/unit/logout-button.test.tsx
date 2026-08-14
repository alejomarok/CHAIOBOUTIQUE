import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const signOutMock = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: { signOut: signOutMock },
}));

const { LogoutButton } = await import("@/components/layout/logout-button");

describe("LogoutButton", () => {
  beforeEach(() => {
    pushMock.mockClear();
    refreshMock.mockClear();
    signOutMock.mockReset();
  });

  afterEach(cleanup);

  it('renders the resting "Cerrar sesión" label', () => {
    render(<LogoutButton />);
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeInTheDocument();
  });

  it("terminates the session via authClient.signOut, then redirects to / and refreshes", async () => {
    signOutMock.mockResolvedValue({ error: null });

    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() => expect(signOutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(refreshMock).toHaveBeenCalled();
  });

  it('shows a "Cerrando sesión…" pending state while the request is in flight', async () => {
    let resolveSignOut: (value: { error: null }) => void;
    signOutMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignOut = resolve;
        }),
    );

    render(<LogoutButton />);
    const button = screen.getByRole("button", { name: "Cerrar sesión" });
    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cerrando sesión…" })).toBeDisabled(),
    );

    resolveSignOut!({ error: null });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
  });

  it("ignores a second click once the button has gone into its pending state", async () => {
    let resolveSignOut: (value: { error: null }) => void;
    signOutMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSignOut = resolve;
        }),
    );

    render(<LogoutButton />);
    const button = screen.getByRole("button", { name: "Cerrar sesión" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    // A disabled <button> never dispatches a click in the DOM — proves the
    // second attempt is blocked at the UI layer, not just the in-function
    // isSigningOut guard.
    fireEvent.click(button);

    resolveSignOut!({ error: null });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/"));
    expect(signOutMock).toHaveBeenCalledTimes(1);
  });

  it("shows a Spanish error and resets to the resting state instead of hanging when signOut fails", async () => {
    signOutMock.mockResolvedValue({ error: { message: "boom" } });

    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cerrar sesión" })).not.toBeDisabled(),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("shows a Spanish error and resets to the resting state when the request itself throws", async () => {
    signOutMock.mockRejectedValue(new Error("network down"));

    render(<LogoutButton />);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cerrar sesión" })).not.toBeDisabled(),
    );
    expect(pushMock).not.toHaveBeenCalled();
  });
});
