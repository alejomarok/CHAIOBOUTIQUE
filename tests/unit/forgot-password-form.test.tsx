import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const { requestPasswordReset } = vi.hoisted(() => ({ requestPasswordReset: vi.fn() }));
vi.mock("@/lib/auth-client", () => ({ authClient: { requestPasswordReset } }));
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
async function submit() {
  render(<ForgotPasswordForm />);
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "user@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar instrucciones" }));
  await waitFor(() => expect(requestPasswordReset).toHaveBeenCalled());
}
describe("password recovery feedback", () => {
  it("does not claim success when the server rejects the origin", async () => {
    requestPasswordReset.mockResolvedValue({ error: { status: 403 } });
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("sitio oficial");
    expect(screen.queryByText(/Si existe una cuenta/)).not.toBeInTheDocument();
  });
  it("recovers from network errors and allows another attempt", async () => {
    requestPasswordReset.mockRejectedValue(new Error("network"));
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("conexión");
    expect(screen.getByRole("button", { name: "Enviar instrucciones" })).toBeEnabled();
  });
  it("keeps the same success message regardless of account existence", async () => {
    requestPasswordReset.mockResolvedValue({ error: null });
    await submit();
    expect(await screen.findByText(/Si existe una cuenta/)).toBeInTheDocument();
  });
});
