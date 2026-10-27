import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";

import { ADMIN_FIXTURE } from "./fixture-credentials";

// Drives the REAL admin form (not a direct service-function call — see
// tests/e2e/public-footer.spec.ts for that finer-grained, form-bypassing
// coverage) end to end: fill -> save -> real HTTP round trip -> footer on
// a fresh navigation. This is the flow the "social networks aren't
// visible" bug report was actually about, so it's the one path that must
// be proven to work through the real UI, not just the underlying service
// layer.
test.describe("admin footer settings (real DB, real HTTP, real admin form)", () => {
  test.afterEach(async () => {
    await prisma.storeConfiguration.update({
      where: { id: "main" },
      data: {
        instagramUrl: null,
        facebookUrl: null,
        tiktokUrl: null,
        publicPhone: null,
        whatsappPhone: null,
        publicEmail: null,
      },
    });
  });

  async function loginAsAdmin(page: import("@playwright/test").Page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);
  }

  // Scoped to the "Redes sociales" card specifically — the settings page
  // has multiple "Guardar cambios" buttons, one per card. [data-slot="card"]
  // is the shadcn Card root — never nested, so this resolves to exactly
  // one element. CardTitle renders a plain <div>, not a heading role — see
  // components/ui/card.tsx — so this scopes by text, not getByRole.
  function socialCard(page: import("@playwright/test").Page) {
    return page.locator("[data-slot='card']").filter({ hasText: "Redes sociales" });
  }

  function contactCard(page: import("@playwright/test").Page) {
    return page.locator("[data-slot='card']").filter({ hasText: "Información de contacto" });
  }

  test("configuring Instagram, then Facebook, then TikTok, then removing Facebook — the footer tracks each step exactly", async ({
    page,
  }) => {
    // First-route compilation plus four real save/navigation cycles can exceed 30s.
    test.setTimeout(120_000);
    await loginAsAdmin(page);

    // Step 1: only Instagram.
    await page.goto("/admin/settings");
    await socialCard(page).getByLabel("Instagram").fill("https://www.instagram.com/chaioboutique");
    await socialCard(page).getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Configuración actualizada correctamente.")).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("link", { name: "Instagram" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Facebook" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "TikTok" })).not.toBeVisible();

    // Step 2: add Facebook (Instagram stays, pre-filled from the server).
    await page.goto("/admin/settings");
    await expect(socialCard(page).getByLabel("Instagram")).toHaveValue(
      "https://www.instagram.com/chaioboutique",
    );
    await socialCard(page).getByLabel("Facebook").fill("https://www.facebook.com/chaioboutique");
    await socialCard(page).getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Configuración actualizada correctamente.")).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("link", { name: "Instagram" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Facebook" })).toBeVisible();
    await expect(page.getByRole("link", { name: "TikTok" })).not.toBeVisible();

    // Step 3: add TikTok — all three now visible.
    await page.goto("/admin/settings");
    await socialCard(page).getByLabel("TikTok").fill("https://www.tiktok.com/@chaioboutique");
    await socialCard(page).getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Configuración actualizada correctamente.")).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("link", { name: "Instagram" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Facebook" })).toBeVisible();
    await expect(page.getByRole("link", { name: "TikTok" })).toBeVisible();

    // Step 4: remove Facebook — Instagram + TikTok remain, Facebook gone.
    await page.goto("/admin/settings");
    await socialCard(page).getByLabel("Facebook").fill("");
    await socialCard(page).getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Configuración actualizada correctamente.")).toBeVisible();

    await page.goto("/");
    await expect(page.getByRole("link", { name: "Instagram" })).toBeVisible();
    await expect(page.getByRole("link", { name: "TikTok" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Facebook" })).not.toBeVisible();
  });

  test("an invalid URL is rejected client-side and never saved", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/settings");

    await socialCard(page).getByLabel("Instagram").fill("not-a-url");
    await socialCard(page).getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("URL inválida")).toBeVisible();

    const config = await prisma.storeConfiguration.findUniqueOrThrow({ where: { id: "main" } });
    expect(config.instagramUrl).toBeNull();
  });

  test("configuring phone and WhatsApp shows real clickable tel:/wa.me links, WhatsApp never showing the raw number as link text", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/settings");

    await contactCard(page).getByLabel("Teléfono").fill("03571 123456");
    await contactCard(page).getByLabel("WhatsApp").fill("+54 9 3571 123456");
    await contactCard(page).getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Configuración actualizada correctamente.")).toBeVisible();

    await page.goto("/");

    const phoneLink = page.getByRole("link", { name: "03571 123456" });
    await expect(phoneLink).toBeVisible();
    await expect(phoneLink).toHaveAttribute("href", /^tel:/);

    // Friendly CTA text, never the raw phone number or the wa.me URL
    // itself as visible text — the real configured number still drives
    // the actual link destination.
    const waLink = page.getByRole("link", { name: "Escribinos por WhatsApp" });
    await expect(waLink).toBeVisible();
    await expect(waLink).toHaveText("Escribinos por WhatsApp");
    await expect(waLink).toHaveAttribute("href", /^https:\/\/wa\.me\/5493571123456$/);
    await expect(waLink).toHaveAttribute("target", "_blank");
    await expect(waLink).toHaveAttribute("rel", "noopener noreferrer");
  });
});
