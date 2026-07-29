import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// Mocked whole, same reasoning as login-form.test.tsx: the real module
// imports @/lib/auth -> @/lib/db -> env validation, which a plain component
// unit test has no business exercising. RegisterForm keeps the officially
// documented static "use server" import; only the test substitutes it.
const registerCustomerActionMock = vi.fn();
vi.mock("@/app/(auth)/register/actions", () => ({
  registerCustomerAction: registerCustomerActionMock,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { RegisterForm } = await import("@/components/auth/register-form");

function fillValidForm() {
  fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Clienta Test" } });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "clienta@chaioboutique.local" },
  });
  fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "password123" } });
  fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
    target: { value: "password123" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Acepto los términos y condiciones" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Acepto la política de privacidad" }));
}

describe("RegisterForm", () => {
  beforeEach(() => {
    pushMock.mockClear();
    registerCustomerActionMock.mockReset();
  });

  afterEach(cleanup);

  it("renders every required field plus the optional marketing checkbox", () => {
    render(<RegisterForm />);

    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.getByLabelText("Confirmar contraseña")).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Acepto los términos y condiciones" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Acepto la política de privacidad" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", {
        name: "Quiero recibir novedades y promociones por email (opcional)",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeInTheDocument();
  });

  it("shows a validation error and never calls the Server Action when terms are not accepted", async () => {
    render(<RegisterForm />);

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Clienta Test" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "clienta@chaioboutique.local" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
      target: { value: "password123" },
    });
    // privacyAccepted checked, termsAccepted deliberately left unchecked.
    fireEvent.click(screen.getByRole("checkbox", { name: "Acepto la política de privacidad" }));
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(
      await screen.findByText("Tenés que aceptar los términos y condiciones"),
    ).toBeInTheDocument();
    expect(registerCustomerActionMock).not.toHaveBeenCalled();
  });

  it("shows a validation error and never calls the Server Action when passwords don't match", async () => {
    render(<RegisterForm />);

    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Clienta Test" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "clienta@chaioboutique.local" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "password123" } });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
      target: { value: "somethingElse123" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Acepto los términos y condiciones" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Acepto la política de privacidad" }));
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    expect(await screen.findByText("Las contraseñas no coinciden")).toBeInTheDocument();
    expect(registerCustomerActionMock).not.toHaveBeenCalled();
  });

  it("calls the expected Server Action with the form values and redirects to /login on success", async () => {
    registerCustomerActionMock.mockResolvedValue({ status: "registered" });
    render(<RegisterForm />);

    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    await waitFor(() =>
      expect(registerCustomerActionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Clienta Test",
          email: "clienta@chaioboutique.local",
          password: "password123",
          passwordConfirmation: "password123",
          termsAccepted: true,
          privacyAccepted: true,
          marketingConsent: false,
        }),
      ),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/login"));
  });

  it("shows a generic error and does not navigate when the Server Action throws", async () => {
    registerCustomerActionMock.mockRejectedValue(new Error("email already exists"));
    render(<RegisterForm />);

    fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Crear cuenta" }));

    await waitFor(() => expect(registerCustomerActionMock).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
  });
});
