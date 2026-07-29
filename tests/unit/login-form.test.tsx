import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
const refreshMock = vi.fn();
let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
  useSearchParams: () => searchParams,
}));

const signInEmailMock = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  authClient: { signIn: { email: signInEmailMock } },
}));

// The real module imports @/lib/auth -> @/lib/db -> env validation, none of
// which is available (or should be exercised) under a plain component unit
// test with no database/env setup — mocked whole, same as authClient above
// and next/navigation. The component itself keeps the officially documented
// Server Action pattern (a static import from a dedicated "use server"
// file) intact; only the test substitutes the module.
const resolvePostLoginDestinationActionMock = vi.fn();
vi.mock("@/app/(auth)/login/actions", () => ({
  resolvePostLoginDestinationAction: resolvePostLoginDestinationActionMock,
}));

const { LoginForm } = await import("@/components/auth/login-form");

describe("LoginForm", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams();
    pushMock.mockClear();
    refreshMock.mockClear();
    signInEmailMock.mockReset();
    resolvePostLoginDestinationActionMock.mockReset();
  });

  afterEach(cleanup);

  it("renders email and password fields with Spanish labels", () => {
    render(<LoginForm />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Contraseña")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Iniciar sesión" })).toBeInTheDocument();
    expect(screen.getByText("¿Olvidaste tu contraseña?")).toBeInTheDocument();
  });

  it("shows validation errors and never calls signIn when the form is invalid", async () => {
    const { container } = render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "not-an-email" } });

    // fireEvent.submit on the <form>, not fireEvent.click on the submit
    // button: with type="email", jsdom applies the same native HTML5
    // constraint validation a real browser would, which blocks a
    // click-triggered implicit submission before React ever sees a submit
    // event — that's the browser's own gate, not our Zod schema, and isn't
    // what this test is checking. Dispatching "submit" directly isolates
    // loginSchema's own validation instead.
    fireEvent.submit(container.querySelector("form")!);

    expect(await screen.findByText("Ingresá un email válido")).toBeInTheDocument();
    expect(signInEmailMock).not.toHaveBeenCalled();
  });

  it("on successful sign-in, always defers to the Server Action for the destination", async () => {
    // The client never decides this itself — only the server knows the
    // account's real permissions. See modules/auth/post-login-redirect.ts.
    signInEmailMock.mockResolvedValue({ error: null });
    resolvePostLoginDestinationActionMock.mockResolvedValue("/admin");

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "admin@chaioboutique.local" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() =>
      expect(signInEmailMock).toHaveBeenCalledWith({
        email: "admin@chaioboutique.local",
        password: "password123",
      }),
    );
    await waitFor(() =>
      expect(resolvePostLoginDestinationActionMock).toHaveBeenCalledWith(null),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin"));
  });

  it("passes a present redirectTo through to the Server Action, which decides whether to honor it", async () => {
    searchParams = new URLSearchParams({ redirectTo: "/admin/products" });
    signInEmailMock.mockResolvedValue({ error: null });
    resolvePostLoginDestinationActionMock.mockResolvedValue("/admin/products");

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "admin@chaioboutique.local" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() =>
      expect(resolvePostLoginDestinationActionMock).toHaveBeenCalledWith("/admin/products"),
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/admin/products"));
  });

  it("navigates to whatever the Server Action returns, never to an unsafe redirectTo directly", async () => {
    searchParams = new URLSearchParams({ redirectTo: "https://evil.com" });
    signInEmailMock.mockResolvedValue({ error: null });
    // The action itself is responsible for rejecting the unsafe value and
    // falling back — this test only confirms the client renders whatever
    // the server decided, never the raw query param.
    resolvePostLoginDestinationActionMock.mockResolvedValue("/catalog");

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "cliente@chaioboutique.local" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "password123" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith("/catalog"));
    expect(pushMock).not.toHaveBeenCalledWith("https://evil.com");
  });
});
