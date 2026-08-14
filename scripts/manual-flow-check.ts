// Ad hoc, read/write diagnostic against the REAL running dev server
// (expects `npm run dev` already listening on localhost:3000, against the
// real DATABASE_URL) — times each navigation, captures console/network
// errors, and reports exactly what happens when logging in and opening a
// product's edit page. Never logs credentials. Not part of any npm script;
// safe to delete once the real bug is found.
import "dotenv/config";
import { chromium, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    console.log(`[TIMING] ${label}: ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    console.log(`[TIMING] ${label}: FAILED after ${Date.now() - start}ms`);
    throw error;
  }
}

async function main() {
  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error("INITIAL_ADMIN_EMAIL/PASSWORD not set in .env");
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[BROWSER CONSOLE ERROR]", msg.text());
  });
  page.on("response", (res) => {
    if (res.status() >= 400) console.log(`[HTTP ${res.status()}]`, res.url());
  });
  page.on("pageerror", (err) => console.log("[PAGE ERROR]", err.message));

  await timed("goto /login", () => page.goto(`${BASE_URL}/login`));
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await timed("login submit -> redirect", async () => {
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    // expect().toHaveURL(), not page.waitForURL(): the latter defaults to
    // waiting for a full browser "load" event, which a Next.js client-side
    // router.replace() never fires (no full navigation occurs) — it would
    // hang for the full timeout even though the URL already changed.
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
  });

  await timed("goto /admin/products (cold)", () => page.goto(`${BASE_URL}/admin/products`));
  await timed("goto /admin/products (warm)", () => page.goto(`${BASE_URL}/admin/products`));

  // Try to find the product's edit link directly.
  const editLink = await page
    .locator('a[href*="/admin/products/"][href$="/edit"]')
    .first()
    .getAttribute("href")
    .catch(() => null);
  console.log("first edit link found on LIST page:", editLink);

  const productId = process.env.TIMING_CHECK_PRODUCT_ID || "cmsgttif500001gesoha27k0o";
  await timed("goto product DETAIL page (cold)", () =>
    page.goto(`${BASE_URL}/admin/products/${productId}`),
  );
  const editButtonVisible = await page
    .getByRole("link", { name: "Editar" })
    .isVisible()
    .catch(() => false);
  console.log("'Editar' link visible on detail page:", editButtonVisible);

  await timed("click Editar -> edit page loads", async () => {
    await page.getByRole("link", { name: "Editar" }).click();
    // See the login-step comment above — same fix, same reason.
    await expect(page).toHaveURL(new RegExp(`/admin/products/${productId}/edit`), {
      timeout: 30_000,
    });
    await page.getByLabel("Nombre").waitFor({ state: "visible", timeout: 30_000 });
  });

  const priceValue = await page
    .getByLabel("Precio", { exact: true })
    .inputValue()
    .catch(() => "N/A");
  console.log("current price field value in edit form:", priceValue);

  const categoryValue = await page
    .getByLabel("Categoría")
    .textContent()
    .catch(() => "N/A");
  console.log("current category field text:", categoryValue);

  await timed("goto edit page directly (warm, second load)", () =>
    page.goto(`${BASE_URL}/admin/products/${productId}/edit`),
  );

  // Real Supabase Storage upload test — the product currently has 0 images.
  await page.goto(`${BASE_URL}/admin/products/${productId}`);
  const fileInput = page.locator('input[type="file"]');
  if (await fileInput.count()) {
    const ONE_PIXEL_PNG = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await fileInput.setInputFiles({
      name: "diagnostic.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });
    try {
      await timed("real Supabase upload (click Subir imagen -> success)", async () => {
        await page.getByRole("button", { name: "Subir imagen" }).click();
        await page.getByText(/Imagen subida|Principal/).first().waitFor({ timeout: 20_000 });
      });
    } catch (uploadError) {
      console.log("[UPLOAD FAILED]", uploadError instanceof Error ? uploadError.message : uploadError);
    }

    const imgSrc = await page
      .locator("img")
      .first()
      .getAttribute("src")
      .catch(() => null);
    console.log("uploaded image <img> src:", imgSrc);

    if (imgSrc) {
      const absoluteUrl = imgSrc.startsWith("http") ? imgSrc : `${BASE_URL}${imgSrc}`;
      const imgResponse = await page.request.get(absoluteUrl).catch((e) => {
        console.log("[IMAGE FETCH ERROR]", e instanceof Error ? e.message : e);
        return null;
      });
      if (imgResponse) {
        console.log(`[IMAGE URL FETCH] status=${imgResponse.status()} url=${absoluteUrl}`);
      }
    }
  } else {
    console.log("no file input found on product detail page");
  }

  await browser.close();
}

main().catch((error) => {
  console.error("manual-flow-check failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
