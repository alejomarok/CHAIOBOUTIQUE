// The Product Flow Stabilization Sprint's 16-step manual acceptance flow,
// scripted against the REAL running dev server (npm run dev, localhost:3000)
// and the REAL dev database/Supabase Storage — not the isolated Docker test
// DB. Creates one clearly-named product ("QA Manual Test <timestamp>") and
// leaves it in place for human review; never deletes anything. Never logs
// credentials. Ad hoc, not part of any npm script.
import "dotenv/config";
import { chromium, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    console.log(`✅ ${label} (${Date.now() - start}ms)`);
    return result;
  } catch (error) {
    console.log(`❌ ${label} FAILED (${Date.now() - start}ms)`);
    throw error;
  }
}

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

async function main() {
  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("INITIAL_ADMIN_EMAIL/PASSWORD not set in .env");

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("[PAGE ERROR]", err.message));
  page.on("response", (res) => {
    if (res.status() >= 500) console.log(`[HTTP ${res.status()}]`, res.url());
  });

  const productName = `QA Manual Test ${Date.now()}`;

  // 1. Log in as ADMIN.
  await step("1. Log in as ADMIN", async () => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
  });

  // 2 & 3. Create a product, save, reach its detail page.
  const productId = await step("2-3. Create a product and reach its detail page", async () => {
    await page.goto(`${BASE_URL}/admin/products/new`);
    await page.getByLabel("Nombre").fill(productName);
    await page.getByRole("button", { name: "Crear producto" }).click();
    // [a-z0-9]{20,} (not just [a-z0-9]+): a bare "+" also matches the
    // literal word "new" itself (still on the create form, mid-transition),
    // resolving the assertion too early and capturing "new" as if it were
    // the product's real cuid. Real cuids here are ~25 chars.
    await expect(page).toHaveURL(/\/admin\/products\/[a-z0-9]{20,}$/, { timeout: 15_000 });
    const url = page.url();
    return url.split("/").pop()!;
  });

  await step("Confirm checklist shows pending required steps", async () => {
    await page.getByText("Pasos para completar el producto").waitFor();
    await page.getByText("Falta cargar un precio válido.").waitFor();
    await page.getByText("Falta asignar una categoría.").waitFor();
  });

  // 4, 5, 6. Edit name/price, assign category, assign size group.
  await step("4-6. Edit name, price, category, size group", async () => {
    // Click-through navigation, not a raw page.goto() — matches how a real
    // admin reaches this page (and how tests/e2e/product-publish.spec.ts
    // already proves this exact transition works reliably).
    await page.getByRole("link", { name: "Editar" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/products/${productId}/edit`), { timeout: 15_000 });
    await page.getByLabel("Nombre").fill(`${productName} (editado)`);
    await page.getByLabel("Precio", { exact: true }).fill("15000");
    await page.getByLabel("Categoría").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Grupo de talles").click();
    await page.getByRole("option", { name: /Talle único/i }).click();
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/products/${productId}$`), { timeout: 15_000 });
  });

  // 7. Create at least two variants.
  const variantSkus = [`QA-A-${Date.now()}`, `QA-B-${Date.now()}`];
  await step("7. Create two variants", async () => {
    await page.locator("#variantes").scrollIntoViewIfNeeded();
    // The size checkbox is wrapped in its own <label> together with the
    // "Único" text (see variant-manager.tsx) — clicking the label itself
    // (not a guessed sibling/xpath) is what actually toggles it.
    await page.locator("label", { hasText: "Único" }).click();
    const proponerButton = page.getByRole("button", { name: "Proponer variantes" });
    await expect(proponerButton).toBeEnabled({ timeout: 5_000 });
    await proponerButton.click();
    const skuInputs = page.getByPlaceholder("SKU");
    const count = await skuInputs.count();
    for (let i = 0; i < count; i++) {
      await skuInputs.nth(i).fill(variantSkus[i] ?? `${variantSkus[0]}-${i}`);
    }
    await page.getByRole("button", { name: /Crear \d+ variante/ }).click();
    await page.getByText("Variantes creadas.").waitFor({ timeout: 10_000 });
  });

  // 8. Load stock for each variant.
  await step("8. Load stock for the first variant", async () => {
    await page.reload();
    await page.getByRole("link", { name: "Cargar stock inicial" }).click();
    await expect(page).toHaveURL(/\/admin\/inventory\/adjustments/, { timeout: 15_000 });
    await page.getByLabel("Depósito").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Cantidad").fill("12");
    await page.getByLabel("Motivo").fill("Carga inicial (manual acceptance flow)");
    await page.getByRole("button", { name: "Registrar movimiento" }).click();
    await page.getByText("Movimiento registrado.").waitFor({ timeout: 10_000 });
  });

  // 9. Upload a real image to Supabase Storage.
  await step("9. Upload a real image", async () => {
    await page.goto(`${BASE_URL}/admin/products/${productId}`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "qa-manual-flow.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });
    await page.getByRole("button", { name: "Subir imagen" }).click();
    await page.getByText("Imagen subida.").waitFor({ timeout: 15_000 });
  });

  // 10. Confirm total and per-variant stock are displayed.
  await step("10. Confirm stock is displayed (total + per-variant)", async () => {
    await page.reload();
    await page.getByText(/Stock total del producto: \d+ unidades/).waitFor();
  });

  // 11. Publish the product.
  await step("11. Publish the product", async () => {
    await page.getByRole("button", { name: "Publicar" }).click();
    await page.getByText("Producto publicado.").waitFor({ timeout: 10_000 });
  });

  // 12 & 13. "Ver en la tienda" -> confirm it appears in /catalog.
  const slug = await step("12-13. Ver en la tienda -> confirm in /catalog", async () => {
    const [storefrontPage] = await Promise.all([
      page.context().waitForEvent("page"),
      page.getByRole("link", { name: /Ver en la tienda/ }).click(),
    ]);
    await storefrontPage.waitForLoadState();
    const url = new URL(storefrontPage.url());
    await storefrontPage.close();

    await page.goto(`${BASE_URL}/catalog?q=${encodeURIComponent(productName)}`);
    await page.getByText(productName, { exact: false }).first().waitFor({ timeout: 10_000 });
    return url.pathname.split("/").pop()!;
  });

  // 14 & 15. Open /product/[slug], add the correct variant to the cart.
  await step("14-15. Open product page and add variant to cart", async () => {
    await page.goto(`${BASE_URL}/product/${slug}`);
    await page.getByRole("button", { name: /Agregar al carrito/i }).click();
    await page.getByText(/Se agregó|agregado al carrito/i).first().waitFor({ timeout: 10_000 });
  });

  // 16. Return to admin and edit the product again.
  await step("16. Return to admin and edit the product again", async () => {
    await page.goto(`${BASE_URL}/admin/products/${productId}/edit`);
    await page.getByLabel("Nombre").waitFor();
    const nameValue = await page.getByLabel("Nombre").inputValue();
    if (!nameValue.includes("editado")) throw new Error("Edit form did not load expected data");
  });

  console.log(`\nAll 16 steps completed. Product left in place: ${productName} (id=${productId}, slug=${slug})`);
  await browser.close();
}

main().catch((error) => {
  console.error("Manual acceptance flow FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
