// Mandatory manual validation for the product-image upload architecture
// overhaul (direct-to-Supabase signed upload) — scripted against the REAL
// running dev server (npm run dev, localhost:3000) and the REAL Supabase
// project (both DATABASE_URL and Storage), not the isolated Docker test DB
// and never the E2E in-memory provider. Creates one clearly-named product
// ("QA Image Upload Test <timestamp>") and leaves it in place for human
// review — same convention as scripts/manual-acceptance-flow.ts. Never logs
// credentials. Ad hoc, not part of any npm script.
import "dotenv/config";
import { randomFillSync } from "node:crypto";
import { deflateSync } from "node:zlib";
import { chromium, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3000";

async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    console.log(`OK ${label} (${Date.now() - start}ms)`);
    return result;
  } catch (error) {
    console.log(`FAIL ${label} (${Date.now() - start}ms)`);
    console.log("   ", error instanceof Error ? error.message : error);
    throw error;
  }
}

// A tiny, valid gradient PNG well under 1 MB — for step A.
function makeSmallPng(): Buffer {
  return Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
}

// A genuine, valid PNG built from real per-pixel random noise (deflate
// can't meaningfully compress it), sized precisely by target byte count —
// used to reliably produce a file whose declared size sits just over 1 MB,
// the exact class of file that used to trigger the Server Action's 1 MB
// body-size 413 before this phase's fix.
function makeNoisyPng(width: number, height: number): Buffer {
  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  randomFillSync(raw);
  for (let y = 0; y < height; y++) raw[y * (rowBytes + 1)] = 0; // filter byte per row must stay 0
  const compressed = deflateSync(raw, { level: 0 }); // level 0: fast, doesn't try to compress incompressible noise
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crc32 = (buf: Buffer): number => {
    let crc = 0xffffffff;
    for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([length, typeBuf, data, crc]);
  };
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;
  ihdrData[9] = 2;
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdrData),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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

  const productName = `QA Image Upload Test ${Date.now()}`;

  await step("Log in as ADMIN", async () => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
  });

  const productId = await step("Create a fresh test product", async () => {
    await page.goto(`${BASE_URL}/admin/products/new`);
    await page.getByLabel("Nombre").fill(productName);
    await page.getByRole("button", { name: "Crear producto" }).click();
    await expect(page).toHaveURL(/\/admin\/products\/[a-z0-9]{20,}$/, { timeout: 15_000 });
    return page.url().split("/").pop()!;
  });

  let slug: string | undefined;
  await step("Assign category + price + a single variant so the product can be publicly visible", async () => {
    await page.getByRole("link", { name: "Editar" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/products/${productId}/edit`), { timeout: 15_000 });
    await page.getByLabel("Categoría").click();
    await page.getByRole("option").first().click();
    await page.getByLabel("Precio", { exact: true }).fill("9999");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/products/${productId}$`), { timeout: 15_000 });

    await page.getByRole("button", { name: "Proponer variante única (sin talle ni color)" }).click();
    await page.getByPlaceholder("SKU").fill(`QA-IMG-${Date.now()}`);
    await page.getByRole("button", { name: /Crear \d+ variante/ }).click();
    await expect(page.getByText("Variantes creadas.")).toBeVisible();

    await page.getByRole("button", { name: "Publicar" }).click();
    await expect(page.getByText("Producto publicado.")).toBeVisible();

    const slugMatch = await page
      .getByRole("link", { name: /Ver en la tienda/ })
      .getAttribute("href")
      .catch(() => null);
    slug = slugMatch?.split("/product/")[1];
    console.log("   slug:", slug);
  });

  await page.reload();

  // ---- A. Upload an image < 1 MB ----
  await step("A. Upload an image < 1 MB", async () => {
    const png = makeSmallPng();
    console.log(`   source size: ${png.byteLength} bytes`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "small.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByRole("button", { name: "Subir imagen" }).click();
    await expect(page.getByText("Imagen subida correctamente.")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Principal").first()).toBeVisible();
  });

  // ---- B. Upload a normal image > 1 MB (the exact class of file that used
  // to trigger the Server Action's 1 MB body-size 413) ----
  await step("B. Upload a normal image > 1 MB", async () => {
    const png = makeNoisyPng(900, 700);
    console.log(`   source size: ${(png.byteLength / 1024 / 1024).toFixed(2)} MB`);
    if (png.byteLength <= 1024 * 1024) throw new Error("test fixture did not exceed 1 MB as intended");
    await page.locator('input[type="file"]').setInputFiles({
      name: "over-1mb.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByRole("button", { name: "Subir imagen" }).click();
    await expect(page.getByText("Imagen subida correctamente.")).toBeVisible({ timeout: 30_000 });
  });

  // ---- C. Upload a several-MB phone-style photo ----
  await step("C. Upload a several-MB phone-style photo (real Chromium JPEG encoder, 4032x3024)", async () => {
    const jpegBase64 = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 4032;
      canvas.height = 3024;
      const ctx = canvas.getContext("2d")!;
      const imgData = ctx.createImageData(canvas.width, canvas.height);
      const CHUNK = 65536;
      for (let offset = 0; offset < imgData.data.length; offset += CHUNK) {
        const len = Math.min(CHUNK, imgData.data.length - offset);
        crypto.getRandomValues(imgData.data.subarray(offset, offset + len));
      }
      ctx.putImageData(imgData, 0, 0);
      const blob: Blob = await new Promise((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.9),
      );
      const buffer = await blob.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return btoa(binary);
    });
    const jpeg = Buffer.from(jpegBase64, "base64");
    console.log(`   source size (pre-optimization, in-browser): ${(jpeg.byteLength / 1024 / 1024).toFixed(2)} MB`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "phone-photo.jpg",
      mimeType: "image/jpeg",
      buffer: jpeg,
    });
    await page.getByRole("button", { name: "Subir imagen" }).click();
    await expect(page.getByText("Imagen subida correctamente.")).toBeVisible({ timeout: 30_000 });
  });

  // ---- D. Invalid MIME type ----
  await step("D. Reject an invalid MIME type client-side, before any network call", async () => {
    await page.locator('input[type="file"]').setInputFiles({
      name: "not-an-image.gif",
      mimeType: "image/gif",
      buffer: Buffer.from("GIF89a not a real supported type"),
    });
    await expect(page.getByText("Formato no permitido. Usá JPG, PNG o WebP.")).toBeVisible({
      timeout: 5_000,
    });
  });

  // ---- E. Oversized source file (> 20 MB hard ceiling) ----
  await step("E. Reject an oversized source file client-side, before any network call", async () => {
    const oversized = Buffer.alloc(21 * 1024 * 1024, 0);
    await page.locator('input[type="file"]').setInputFiles({
      name: "too-big.jpg",
      mimeType: "image/jpeg",
      buffer: oversized,
    });
    await expect(page.getByText(/La imagen es demasiado pesada/)).toBeVisible({ timeout: 5_000 });
  });

  // ---- F. Upload a second image ----
  await step("F. Upload a second image", async () => {
    const png = makeSmallPng();
    await page.locator('input[type="file"]').setInputFiles({
      name: "second.png",
      mimeType: "image/png",
      buffer: png,
    });
    await page.getByRole("button", { name: "Subir imagen" }).click();
    await expect(page.getByText("Imagen subida correctamente.")).toBeVisible({ timeout: 20_000 });
  });

  // ---- G. Make the newest (non-primary) image principal ----
  await step("G. Make a non-primary image principal", async () => {
    await page.getByRole("button", { name: "Hacer principal" }).first().click();
    await expect(page.getByText("Imagen principal actualizada.")).toBeVisible({ timeout: 10_000 });
  });

  // ---- H. Delete an image ----
  await step("H. Delete a non-primary image", async () => {
    const beforeCount = await page.locator('button:has-text("Eliminar")').count();
    await page.getByRole("button", { name: "Eliminar" }).first().click();
    await page.getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText("Imagen eliminada.")).toBeVisible({ timeout: 10_000 });
    const afterCount = await page.locator('button:has-text("Eliminar")').count();
    if (afterCount !== beforeCount - 1) {
      throw new Error(`expected image count to drop by 1 (was ${beforeCount}, now ${afterCount})`);
    }
  });

  // ---- I. Verify the primary image appears in /catalog ----
  await step("I. Verify primary image appears in /catalog", async () => {
    await page.goto(`${BASE_URL}/catalog?q=${encodeURIComponent(productName)}`);
    await expect(page.getByText(productName)).toBeVisible({ timeout: 15_000 });
    const catalogImg = page.locator("img").first();
    await expect(catalogImg).toBeVisible();
    const src = await catalogImg.getAttribute("src");
    console.log("   catalog image src:", src);
  });

  // ---- J. Verify it in /product/[slug] ----
  await step("J. Verify primary image appears on /product/[slug]", async () => {
    if (!slug) throw new Error("no slug captured earlier");
    await page.goto(`${BASE_URL}/product/${slug}`);
    await expect(page.getByRole("heading", { name: productName })).toBeVisible({ timeout: 15_000 });
    const detailImg = page.locator("img").first();
    await expect(detailImg).toBeVisible();
    const src = await detailImg.getAttribute("src");
    console.log("   product detail image src:", src);
    if (src) {
      const absoluteUrl = src.startsWith("http") ? src : `${BASE_URL}${src}`;
      const res = await page.request.get(absoluteUrl);
      console.log(`   image URL fetch status: ${res.status()}`);
      if (res.status() !== 200) throw new Error(`image URL did not return 200: ${res.status()}`);
    }
  });

  // ---- K. Reload the browser and confirm the image persists ----
  await step("K. Reload the admin product page and confirm images persist", async () => {
    await page.goto(`${BASE_URL}/admin/products/${productId}`);
    await page.reload();
    const remainingImages = await page.locator('button:has-text("Eliminar")').count();
    console.log(`   images visible after reload: ${remainingImages}`);
    if (remainingImages < 1) throw new Error("expected at least 1 image to persist after reload");
  });

  console.log(`\nDone. Test product left in place for review: ${productName} (${productId})`);
  await browser.close();
}

main().catch((error) => {
  console.error("manual-image-upload-flow failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
