import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked whole, same reasoning as login-form.test.tsx/register-form.test.tsx:
// the real action module imports @/lib/auth -> @/lib/db -> env validation,
// which a plain component unit test has no business exercising.
const resendVerificationEmailActionMock = vi.fn();
vi.mock("@/app/(auth)/verify-email/actions", () => ({
  resendVerificationEmailAction: resendVerificationEmailActionMock,
}));

const { ResendVerificationForm } = await import("@/components/auth/resend-verification-form");

describe("ResendVerificationForm", () => {
  beforeEach(() => {
    resendVerificationEmailActionMock.mockReset();
  });

  afterEach(cleanup);

  it("prefills the email field when a defaultEmail is provided", () => {
    render(<ResendVerificationForm defaultEmail="clienta@chaioboutique.local" />);
    expect(screen.getByLabelText("Email")).toHaveValue("clienta@chaioboutique.local");
  });

  it("shows a generic 'sent' message regardless of what the account actually is", async () => {
    resendVerificationEmailActionMock.mockResolvedValue({ status: "sent" });
    render(<ResendVerificationForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "cualquiera@chaioboutique.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reenviar enlace de verificación" }));

    expect(
      await screen.findByText(
        "Si tu cuenta existe y todavía no confirmaste tu email, te enviamos un nuevo enlace.",
      ),
    ).toBeInTheDocument();
    expect(resendVerificationEmailActionMock).toHaveBeenCalledWith({
      email: "cualquiera@chaioboutique.local",
    });
  });

  it("shows a distinct cooldown message without ever calling it an error", async () => {
    resendVerificationEmailActionMock.mockResolvedValue({ status: "cooldown" });
    render(<ResendVerificationForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "cualquiera@chaioboutique.local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reenviar enlace de verificación" }));

    expect(
      await screen.findByText(
        "Ya pedimos un enlace hace poco. Esperá unos minutos antes de volver a intentar.",
      ),
    ).toBeInTheDocument();
  });

  it("disables the submit button while the request is in flight", async () => {
    let resolveAction: (value: { status: "sent" }) => void = () => {};
    resendVerificationEmailActionMock.mockReturnValue(
      new Promise((resolve) => {
        resolveAction = resolve;
      }),
    );
    render(<ResendVerificationForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "cualquiera@chaioboutique.local" },
    });
    const button = screen.getByRole("button", { name: "Reenviar enlace de verificación" });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole("button")).toBeDisabled());
    resolveAction({ status: "sent" });
  });
});
