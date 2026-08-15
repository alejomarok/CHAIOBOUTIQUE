// The Sales/POS Foundation phase's mandatory manual acceptance flow,
// scripted against the REAL running dev server (npm run dev:local,
// localhost:3000) and the REAL local postgres-dev database — not the
// isolated Docker test DB, and never Supabase. Creates one clearly-named
// product and leaves the resulting sale(s) in place for human review, same
// convention as scripts/manual-customer-acceptance-flow.ts. Never logs
// credentials. Ad hoc, not part of any npm script.
//
// SAFETY: this script opens its own Prisma connection (separate from the
// already-running dev:local server), so with-dev-db.mjs does NOT protect
// it — plain `dotenv/config` alone loads .env's raw DATABASE_URL, which
// defaults to Supabase (see .env.example). Forces DATABASE_URL/DIRECT_URL
// to DEV_DATABASE_URL with the same fail-closed assertion as
// with-dev-db.mjs, before importing anything Prisma-backed — see
// scripts/manual-sales-inventory-acceptance-flow.ts for the incident this
// guard was added in response to.
import "dotenv/config";
import { chromium, expect } from "@playwright/test";

const BASE_URL = "http://localhost:3000";
const EXPECTED_DEV_HOST = "localhost";
const EXPECTED_DEV_PORT = "56033";
const EXPECTED_DEV_DATABASE_NAME = "chaioboutique_dev";

function forceDevDatabaseOrThrow(): void {
  const devUrl = process.env.DEV_DATABASE_URL;
  if (!devUrl) {
    throw new Error(
      "DEV_DATABASE_URL is not set. Refusing to run — set it in .env (see .env.example) to " +
        "your local postgres-dev database.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(devUrl);
  } catch {
    throw new Error(`DEV_DATABASE_URL is not a valid URL: "${devUrl}".`);
  }

  const host = parsed.hostname;
  const port = parsed.port;
  const databaseName = parsed.pathname.replace(/^\//, "").split("?")[0];
  const isSafeHost = host === EXPECTED_DEV_HOST || host === "127.0.0.1";
  const isSafePort = port === EXPECTED_DEV_PORT;
  const isSafeDatabaseName = databaseName === EXPECTED_DEV_DATABASE_NAME;

  if (!isSafeHost || !isSafePort || !isSafeDatabaseName) {
    throw new Error(
      "DEV_DATABASE_URL doesn't look like the local postgres-dev database " +
        `(expected ${EXPECTED_DEV_HOST}:${EXPECTED_DEV_PORT}/${EXPECTED_DEV_DATABASE_NAME}, ` +
        `got "${host}:${port}/${databaseName}"). Refusing to run — this guard exists so this ` +
        "script can never point at Supabase or the test database. Mirrors " +
        "scripts/with-dev-db.mjs's assertSafeDevDatabase — never bypass it.",
    );
  }

  process.env.DATABASE_URL = devUrl;
  process.env.DIRECT_URL = devUrl;
  console.log(`Forced DATABASE_URL to postgres-dev: ${host}:${port}/${databaseName}`);
}

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

async function main() {
  forceDevDatabaseOrThrow();

  const email = process.env.INITIAL_ADMIN_EMAIL;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!email || !password) throw new Error("INITIAL_ADMIN_EMAIL/PASSWORD not set in .env");

  const { prisma } = await import("../src/lib/db-core");
  const { createCategory } = await import("../src/modules/categories/service-core");
  const { createProduct, createVariants } = await import("../src/modules/products/service-core");

  const runTag = Date.now();
  const admin = await prisma.user.findUniqueOrThrow({ where: { email } });
  const category = await createCategory({ name: `Ventas QA Cat ${runTag}` }, admin.id);
  const product = await createProduct(
    { name: `Ventas QA Producto ${runTag}`, categoryId: category.id, defaultPriceAmount: 250000n },
    admin.id,
  );
  const sku = `VEN-QA-${runTag}`;
  await createVariants(product.id, [{ sizeOptionId: null, colorId: null, sku }], admin.id);
  console.log(`Test product ready: ${product.name} / SKU ${sku} / $2500.00`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("[PAGE ERROR]", err.message));
  page.on("response", (res) => {
    if (res.status() >= 500) console.log(`[HTTP ${res.status()}]`, res.url());
  });

  await step("Log in as ADMIN", async () => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
  });

  await step("Open Ventas from the nav", async () => {
    await page.getByRole("link", { name: "Ventas" }).click();
    await expect(page).toHaveURL(/\/admin\/sales$/, { timeout: 15_000 });
  });

  await step("Reject confirming a sale with no items", async () => {
    await page.getByRole("link", { name: "Nueva venta" }).click();
    await expect(page).toHaveURL(/\/admin\/sales\/new/, { timeout: 15_000 });
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    await expect(page.getByText("Agregá al menos un producto.")).toBeVisible({ timeout: 5_000 });
  });

  const draftId = await step("Add the product and save as draft", async () => {
    await page.getByPlaceholder("Buscar por nombre, SKU o código de barras").fill(sku);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByText(sku, { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Agregar" }).click();
    await page.getByRole("spinbutton").fill("3");
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page).toHaveURL(/\/admin\/sales\/[a-z0-9]{20,}$/, { timeout: 15_000 });
    return page.url().split("/").pop()!;
  });
  console.log("   draftId:", draftId);

  const draftFromDb = await step("Look up the draft's code directly (list search is by code/customer, not id)", async () => {
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: draftId } });
    if (sale.status !== "DRAFT") throw new Error(`expected DRAFT, got ${sale.status}`);
    if (sale.totalAmount !== 750000n) {
      throw new Error(`expected total 750000 (3 x 250000), got ${sale.totalAmount}`);
    }
    return sale;
  });

  await step("Search the sales list by code and find the draft", async () => {
    await page.goto(`${BASE_URL}/admin/sales`);
    await page.getByLabel("Buscar").fill(draftFromDb.code);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByRole("link", { name: draftFromDb.code })).toBeVisible({ timeout: 10_000 });
    // "Borrador" also appears as an <option> in the status filter <select>
    // — scope to the actual status Badge cell to avoid that ambiguity.
    await expect(page.getByRole("cell", { name: "Borrador" })).toBeVisible();
  });

  await step("Reopen the draft — it's still editable (the same form, not read-only)", async () => {
    await page.goto(`${BASE_URL}/admin/sales/${draftId}`);
    await expect(page.getByRole("button", { name: "Confirmar venta" })).toBeVisible({ timeout: 10_000 });
  });

  await step("Confirm the sale", async () => {
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/sales/${draftId}$`), { timeout: 15_000 });
    await expect(page.getByText("Confirmada", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  await step("A confirmed sale is read-only — no editable form, no 'Guardar borrador'", async () => {
    await expect(page.getByRole("button", { name: "Guardar borrador" })).not.toBeVisible();
    // Scoped to <main> — "Productos" also matches the sidebar nav link.
    await expect(page.getByRole("main").getByText("Productos", { exact: true })).toBeVisible();
  });

  await step("Cancel the confirmed sale", async () => {
    await page.getByRole("button", { name: "Cancelar venta" }).click();
    await page.getByPlaceholder("Motivo (opcional)").fill("Prueba de aceptación manual");
    await page.getByRole("button", { name: "Confirmar cancelación" }).click();
    await expect(page.getByText("Cancelada", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  await step("A cancelled sale has no cancel action left", async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Cancelar venta" })).not.toBeVisible();
  });

  console.log(
    `\nDone. Test product left in place for review: ${product.name} (${product.id}). Sale: ${draftFromDb.code} (${draftId}, now CANCELLED).`,
  );
  await browser.close();
}

main().catch((error) => {
  console.error("manual-sales-acceptance-flow failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
