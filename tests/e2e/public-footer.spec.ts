import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";
import { listActiveBranches } from "@/modules/store-branches/branch-core";
import { updateStoreConfiguration } from "@/modules/store-settings/service-core";

import { ADMIN_FIXTURE } from "./fixture-credentials";

// Real HTTP against the isolated Docker test database — proves the footer
// genuinely reflects live StoreConfiguration/StoreBranch data, not just
// that the underlying service functions return the right values in
// isolation (see tests/integration/store-settings-branches.test.ts for
// that finer-grained coverage).
test.describe("public footer (real DB, real HTTP)", () => {
  test.afterEach(async () => {
    // Reset to the "nothing configured" baseline so this test is
    // repeatable and never leaks state into any other spec's footer
    // assertions.
    await prisma.storeConfiguration.update({
      where: { id: "main" },
      data: {
        publicPhone: null,
        whatsappPhone: null,
        publicEmail: null,
        instagramUrl: null,
        facebookUrl: null,
        tiktokUrl: null,
      },
    });
  });

  test("shows real branches and keeps unconfigured social icons visible without dead links", async ({
    page,
  }) => {
    await page.goto("/");

    // Only the current branch is public; Río Tercero has closed.
    await expect(page.getByText("Río Tercero", { exact: true })).not.toBeVisible();
    await expect(page.getByText("Libertad 161")).not.toBeVisible();
    await expect(page.getByText("Embalse", { exact: true })).toBeVisible();
    await expect(page.getByText("Av. Pistarini 141")).toBeVisible();

    const socials = page.getByRole("navigation", { name: "Redes sociales" });
    for (const label of ["Instagram", "Facebook", "WhatsApp"]) {
      await expect(socials.getByRole("img", { name: `${label}, próximamente` })).toBeVisible();
    }

    // Nothing configured yet — no dead placeholder links, no invented
    // contact info, no "Seguinos"/"Contacto" heading with nothing under it.
    await expect(page.getByRole("link", { name: "Instagram" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Facebook" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "TikTok" })).not.toBeVisible();
    await expect(page.getByRole("heading", { name: "Contacto" })).not.toBeVisible();
  });

  test("shows configured contact info and social links with safe external-link attributes, and hides the one network left blank", async ({
    page,
  }) => {
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_FIXTURE.email } });
    await updateStoreConfiguration(
      {
        publicPhone: "03571123456",
        whatsappPhone: "+5493571123456",
        publicEmail: "hola@chaioboutique.local",
        instagramUrl: "https://instagram.com/chaioboutique",
        facebookUrl: "https://facebook.com/chaioboutique",
        tiktokUrl: null, // deliberately left blank — must not render
      },
      actor.id,
    );

    await page.goto("/");

    // Phone is a real tel: link.
    const phoneLink = page.getByRole("link", { name: "03571123456" });
    await expect(phoneLink).toBeVisible();
    await expect(phoneLink).toHaveAttribute("href", /^tel:/);

    // WhatsApp uses the configured number, opens safely in a new tab.
    const waLink = page
      .getByRole("navigation", { name: "Redes sociales" })
      .getByRole("link", { name: "WhatsApp", exact: true });
    await expect(waLink).toBeVisible();
    await expect(waLink).toHaveAttribute("href", /^https:\/\/wa\.me\/5493571123456$/);
    await expect(waLink).toHaveAttribute("target", "_blank");
    await expect(waLink).toHaveAttribute("rel", "noopener noreferrer");

    // Email is a real mailto: link.
    const emailLink = page.getByRole("link", { name: "hola@chaioboutique.local" });
    await expect(emailLink).toHaveAttribute("href", "mailto:hola@chaioboutique.local");

    // Instagram/Facebook are configured — real URL, safe external-link
    // attributes, accessible label.
    const instagramLink = page.getByRole("link", { name: "Instagram" });
    await expect(instagramLink).toHaveAttribute("href", "https://instagram.com/chaioboutique");
    await expect(instagramLink).toHaveAttribute("target", "_blank");
    await expect(instagramLink).toHaveAttribute("rel", "noopener noreferrer");

    const facebookLink = page.getByRole("link", { name: "Facebook" });
    await expect(facebookLink).toHaveAttribute("href", "https://facebook.com/chaioboutique");

    // TikTok was left blank — must not render at all, never a dead link.
    await expect(page.getByRole("link", { name: "TikTok" })).not.toBeVisible();

    // No href="#" placeholders anywhere in the footer's social/contact area.
    const hrefValues = await page
      .locator("footer a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
    expect(hrefValues).not.toContain("#");
  });

  test("mobile viewport (375px): footer stacks cleanly with no horizontal overflow", async ({
    page,
  }) => {
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_FIXTURE.email } });
    await updateStoreConfiguration(
      { publicPhone: "03571123456", instagramUrl: "https://instagram.com/chaioboutique" },
      actor.id,
    );

    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");
    await page.locator("footer").scrollIntoViewIfNeeded();

    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(hasOverflow).toBe(false);

    await expect(page.getByText("Río Tercero", { exact: true })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Instagram" })).toBeVisible();
  });

  // 1440/1024/768/390 — the exact breakpoints this phase's own manual
  // acceptance checklist calls out. No horizontal overflow at any of them,
  // branches stay readable, and — at 390px specifically — the social icon
  // links meet a real minimum touch-target size (44px, the standard mobile
  // accessibility guideline), not just a desktop-sized icon shrunk onto a
  // phone screen.
  for (const width of [1440, 1024, 768, 390]) {
    test(`responsive at ${width}px: no horizontal overflow, branches and social links stay visible`, async ({
      page,
    }) => {
      const actor = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_FIXTURE.email } });
      await updateStoreConfiguration(
        {
          publicPhone: "03571123456",
          whatsappPhone: "+5493571123456",
          instagramUrl: "https://instagram.com/chaioboutique",
          facebookUrl: "https://facebook.com/chaioboutique",
          tiktokUrl: "https://tiktok.com/@chaioboutique",
        },
        actor.id,
      );

      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await page.locator("footer").scrollIntoViewIfNeeded();

      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(hasOverflow).toBe(false);

      await expect(page.getByText("Río Tercero", { exact: true })).not.toBeVisible();
      await expect(page.getByText("Embalse", { exact: true })).toBeVisible();
      const instagramLink = page.getByRole("link", { name: "Instagram" });
      await expect(instagramLink).toBeVisible();
      await expect(page.getByRole("link", { name: "Facebook" })).toBeVisible();
      await expect(page.getByRole("link", { name: "TikTok" })).toBeVisible();

      if (width === 390) {
        const box = await instagramLink.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
    });
  }

  test("branches shown on the footer match the real admin-editable StoreBranch data", async ({
    page,
  }) => {
    const branches = await listActiveBranches();
    await page.goto("/catalog");
    for (const branch of branches) {
      await expect(page.getByText(branch.name, { exact: true })).toBeVisible();
      await expect(page.getByText(branch.address)).toBeVisible();
    }
  });
});
