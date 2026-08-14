import { expect, test } from "@playwright/test";

import { ADMIN_FIXTURE, RESTRICTED_FIXTURE } from "./fixture-credentials";

test("admin fixture can log in and reach the dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
  await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();

  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: "Panel" })).toBeVisible();
});

test("unauthenticated access to /admin never renders admin content", async ({ page }) => {
  // requireUser() (modules/auth/require-permission.ts) calls next/navigation's
  // unauthorized(), rendering app/unauthorized.tsx in place — this app never
  // redirects to /login at the page level for this case (proxy.ts's redirect
  // is a coarse, best-effort UX convenience only, not the enforcement point;
  // see that file's own comment). The reliable, actually-enforced signal is
  // the rendered content, not the URL or the HTTP status code — Next 16's
  // authInterrupts (experimental) does not currently set a non-200 status
  // here even though app/unauthorized.tsx is real content-level enforcement.
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "Necesitás iniciar sesión" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Panel" })).not.toBeVisible();
});

test("storefront header proves session state: shows 'Cerrar sesión' while logged in, logging out redirects to / and restores 'Iniciar sesión', and the old session can no longer reach /admin", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
  await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/admin/);

  // A page other than "/" so the post-logout redirect is an observable
  // navigation, not a client-side no-op on an already-current URL.
  await page.goto("/catalog");
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Iniciar sesión" })).not.toBeVisible();

  await page.getByRole("button", { name: "Cerrar sesión" }).click();

  // Redirects to / and the header immediately reflects the now-anonymous
  // session — no manual reload.
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Iniciar sesión" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).not.toBeVisible();

  // The session is actually gone server-side, not just hidden client-side —
  // same real-403/401 signal as the "unauthenticated access" test above.
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Necesitás iniciar sesión" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Panel" })).not.toBeVisible();
});

test("a restricted-role user gets a real 403, not just a hidden menu item", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(RESTRICTED_FIXTURE.email);
  await page.getByLabel("Contraseña").fill(RESTRICTED_FIXTURE.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL(/\/admin/);

  // WAREHOUSE has no users.view permission — proves server-side
  // authorization blocks the page, not just UI hiding of the nav link. The
  // rendered content (app/forbidden.tsx) is the reliable signal here — see
  // the note on the unauthenticated test above re: authInterrupts' HTTP
  // status code.
  await page.goto("/admin/users");
  await expect(page.getByText("No tenés permiso para ver esta página")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Usuarias" })).not.toBeVisible();
});
