import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const { signOutMock, navigateMock } = vi.hoisted(() => ({
  signOutMock: vi.fn(),
  navigateMock: vi.fn(),
}));
vi.mock("@/lib/auth-client", () => ({ authClient: { signOut: signOutMock } }));
vi.mock("@/lib/logout-navigation", () => ({ navigateAfterLogout: navigateMock }));
const { LogoutButton } = await import("@/components/layout/logout-button");
function openConfirmation() {
  fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
  return screen.getByRole("button", { name: "Sí, cerrar sesión" });
}
beforeEach(() => {
  signOutMock.mockReset();
  navigateMock.mockReset();
});
afterEach(cleanup);
describe("confirmed logout", () => {
  it("asks before signing out and allows cancelling without changing the session", async () => {
    render(<LogoutButton />);
    openConfirmation();
    expect(screen.getByRole("dialog", { name: "¿Querés cerrar sesión?" })).toBeInTheDocument();
    expect(signOutMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(signOutMock).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });
  it("removes the session before replacing the document to clear authenticated headers", async () => {
    signOutMock.mockResolvedValue({ error: null });
    render(<LogoutButton />);
    fireEvent.click(openConfirmation());
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(signOutMock.mock.invocationCallOrder[0]).toBeLessThan(
      navigateMock.mock.invocationCallOrder[0],
    );
  });
  it("prevents double confirmation and keeps the pending state until navigation", async () => {
    let resolve!: (value: { error: null }) => void;
    signOutMock.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render(<LogoutButton />);
    const confirm = openConfirmation();
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cerrando sesión…" })).toBeDisabled(),
    );
    fireEvent.click(confirm);
    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    expect(navigateMock).not.toHaveBeenCalled();
    resolve({ error: null });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/"));
  });
  it.each(["server", "network"])(
    "allows retrying after a %s error and does not navigate",
    async (kind) => {
      if (kind === "server") signOutMock.mockResolvedValue({ error: { message: "failed" } });
      else signOutMock.mockRejectedValue(new Error("network"));
      render(<LogoutButton />);
      fireEvent.click(openConfirmation());
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Sí, cerrar sesión" })).toBeEnabled(),
      );
      expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cerrar la sesión");
      expect(navigateMock).not.toHaveBeenCalled();
    },
  );
});
