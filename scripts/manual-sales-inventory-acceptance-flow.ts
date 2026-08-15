// The Sales -> Inventory Integration phase's mandatory manual acceptance
// flow (scenarios A-E from the phase spec), scripted against the REAL
// running dev server (npm run dev:local, localhost:3000) and the REAL
// local postgres-dev database — not the isolated Docker test DB, and never
// Supabase. Creates clearly-named products and leaves the resulting
// sales/movements in place for human review, same convention as
// scripts/manual-sales-acceptance-flow.ts. Never logs credentials. Ad hoc,
// not part of any npm script.
//
// SAFETY: this script's own Prisma writes (product/category/variant/stock
// setup) are a SEPARATE process from the already-running dev:local server,
// so `npm run dev:local`'s own with-dev-db.mjs wrapper does NOT protect
// this script — plain `dotenv/config` alone loads .env's raw DATABASE_URL,
// which defaults to Supabase (see .env.example). This script forces
// DATABASE_URL/DIRECT_URL to DEV_DATABASE_URL itself, with the exact same
// fail-closed host/port/database-name assertion as with-dev-db.mjs, BEFORE
// importing anything that touches Prisma — so it can never again silently
// write test data to production, regardless of how it's invoked.
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
  const { adjustInventory, getInventoryBalance } = await import(
    "../src/modules/inventory/service-core"
  );
  const { getDefaultWarehouse } = await import("../src/modules/warehouses/service-core");
  const { cancelSale } = await import("../src/modules/sales/sale-core");

  const runTag = Date.now();
  const admin = await prisma.user.findUniqueOrThrow({ where: { email } });
  const warehouse = await getDefaultWarehouse();
  if (!warehouse) throw new Error("No default warehouse in postgres-dev — run the seed first.");
  console.log(`Using default warehouse: ${warehouse.name} (${warehouse.id})`);

  async function makeVariant(label: string, price: bigint) {
    const category = await createCategory({ name: `Ventas-Stock QA ${label} ${runTag}` }, admin.id);
    const product = await createProduct(
      { name: `Ventas-Stock QA ${label} ${runTag}`, categoryId: category.id, defaultPriceAmount: price },
      admin.id,
    );
    const sku = `VEN-STK-${label}-${runTag}`;
    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku }],
      admin.id,
    );
    return { product, variant, sku };
  }

  // -------------------------------------------------------------------
  // Setup: two independent variants — one for scenarios A-D (starts with
  // 10 units), one for scenario E's concurrency race (starts with 1 unit).
  // -------------------------------------------------------------------
  const main1 = await makeVariant("Principal", 100000n);
  await adjustInventory({
    variantId: main1.variant.id,
    warehouseId: warehouse.id,
    quantityDelta: 10,
    movementType: "INITIAL_STOCK",
    actorId: admin.id,
  });
  console.log(`Variant for A-D ready: ${main1.sku}, stock=10`);

  const raceItem = await makeVariant("Concurrencia", 50000n);
  await adjustInventory({
    variantId: raceItem.variant.id,
    warehouseId: warehouse.id,
    quantityDelta: 1,
    movementType: "INITIAL_STOCK",
    actorId: admin.id,
  });
  console.log(`Variant for E ready: ${raceItem.sku}, stock=1`);

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

  // ===================================================================
  // Scenario A — variant stock=10, sell qty 3, confirm, verify stock=7.
  // ===================================================================
  const saleAId = await step("[A] Create a sale for qty 3, confirm it, stock 10 -> 7", async () => {
    await page.goto(`${BASE_URL}/admin/sales/new`);
    await page.getByPlaceholder("Buscar por nombre, SKU o código de barras").fill(main1.sku);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByText(main1.sku, { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Disponible: 10")).toBeVisible();
    await page.getByRole("button", { name: "Agregar" }).click();
    await page.getByRole("spinbutton").fill("3");
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    await expect(page).toHaveURL(/\/admin\/sales\/[a-z0-9]{20,}$/, { timeout: 15_000 });
    await expect(page.getByText("Confirmada", { exact: true })).toBeVisible();
    await expect(page.getByText("Stock descontado: Sí")).toBeVisible();
    return page.url().split("/").pop()!;
  });

  await step("[A] Verify InventoryBalance is exactly 7 in postgres-dev", async () => {
    const balance = await getInventoryBalance(main1.variant.id, warehouse.id);
    if (balance?.quantity !== 7) throw new Error(`expected 7, got ${balance?.quantity}`);
  });

  // ===================================================================
  // Scenario B — draft qty 20 vs 7 available: confirm must be rejected,
  // stock stays 7, sale stays DRAFT.
  // ===================================================================
  const draftBId = await step("[B] Save a draft for qty 20 (only 7 available)", async () => {
    await page.goto(`${BASE_URL}/admin/sales/new`);
    await page.getByPlaceholder("Buscar por nombre, SKU o código de barras").fill(main1.sku);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByText(main1.sku, { exact: true })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Agregar" }).click();
    await page.getByRole("spinbutton").fill("20");
    await expect(page.getByText("Stock insuficiente")).toBeVisible();
    await page.getByRole("button", { name: "Guardar borrador" }).click();
    await expect(page).toHaveURL(/\/admin\/sales\/[a-z0-9]{20,}$/, { timeout: 15_000 });
    return page.url().split("/").pop()!;
  });

  await step("[B] Attempt to confirm the draft — rejected with the exact Spanish message", async () => {
    await page.getByRole("button", { name: "Confirmar venta" }).click();
    await expect(
      page.getByText(/No hay stock suficiente.*\n?Disponible: 7\n?Solicitado: 20\./),
    ).toBeVisible({ timeout: 10_000 });
  });

  await step("[B] Verify stock stayed at 7 and the sale is still DRAFT", async () => {
    const balance = await getInventoryBalance(main1.variant.id, warehouse.id);
    if (balance?.quantity !== 7) throw new Error(`expected 7, got ${balance?.quantity}`);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: draftBId } });
    if (sale.status !== "DRAFT") throw new Error(`expected DRAFT, got ${sale.status}`);
  });

  // ===================================================================
  // Scenario C — cancel the qty-3 confirmed sale from A: stock back to
  // 10, reversal movement exists, sale = CANCELLED.
  // ===================================================================
  await step("[C] Cancel the confirmed sale from scenario A", async () => {
    await page.goto(`${BASE_URL}/admin/sales/${saleAId}`);
    await page.getByRole("button", { name: "Cancelar venta" }).click();
    await page.getByPlaceholder("Motivo de cancelación (obligatorio)").fill("Prueba de aceptación manual — escenario C");
    await page.getByRole("button", { name: "Confirmar cancelación" }).click();
    await expect(page.getByText("Cancelada", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  await step("[C] Verify stock is back to 10 and a SALE_CANCELLATION movement exists", async () => {
    const balance = await getInventoryBalance(main1.variant.id, warehouse.id);
    if (balance?.quantity !== 10) throw new Error(`expected 10, got ${balance?.quantity}`);
    const movements = await prisma.inventoryMovement.findMany({
      where: { relatedEntityType: "Sale", relatedEntityId: saleAId },
      orderBy: { createdAt: "asc" },
    });
    const types = movements.map((m) => [m.movementType, m.quantityDelta]);
    console.log("   movements:", JSON.stringify(types));
    if (types.length !== 2 || types[0][0] !== "SALE" || types[1][0] !== "SALE_CANCELLATION") {
      throw new Error(`expected [SALE -3, SALE_CANCELLATION +3], got ${JSON.stringify(types)}`);
    }
  });

  // ===================================================================
  // Scenario D — attempt to cancel again: rejected, no second
  // restoration.
  // ===================================================================
  await step("[D] The UI no longer offers a cancel action on an already-cancelled sale", async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: "Cancelar venta" })).not.toBeVisible();
  });

  await step("[D] A direct second cancelSale() call is rejected (SaleAlreadyCancelledError)", async () => {
    let threw = false;
    try {
      await cancelSale(saleAId, "Segundo intento — no debería aplicarse", admin.id);
    } catch (error) {
      threw = true;
      if (!(error instanceof Error) || error.name !== "SaleAlreadyCancelledError") {
        throw new Error(`expected SaleAlreadyCancelledError, got ${error}`);
      }
    }
    if (!threw) throw new Error("expected the second cancellation to throw, but it succeeded");
  });

  await step("[D] Verify stock is still exactly 10 — not double-restored", async () => {
    const balance = await getInventoryBalance(main1.variant.id, warehouse.id);
    if (balance?.quantity !== 10) throw new Error(`expected 10 (not 13), got ${balance?.quantity}`);
  });

  // ===================================================================
  // Scenario E — two competing confirmations against 1 unit of stock:
  // only one may succeed, stock never goes negative. Driven as two real,
  // near-simultaneous HTTP requests against the live dev server (two
  // separate logged-in browser pages), not an in-process function race.
  // ===================================================================
  const [draftE1Id, draftE2Id] = await step(
    "[E] Save two separate DRAFT sales for qty 1 each, against the qty=1 variant",
    async () => {
      async function saveDraft() {
        await page.goto(`${BASE_URL}/admin/sales/new`);
        await page.getByPlaceholder("Buscar por nombre, SKU o código de barras").fill(raceItem.sku);
        await page.getByRole("button", { name: "Buscar" }).click();
        await expect(page.getByText(raceItem.sku, { exact: true })).toBeVisible({ timeout: 10_000 });
        await page.getByRole("button", { name: "Agregar" }).click();
        await page.getByRole("button", { name: "Guardar borrador" }).click();
        await expect(page).toHaveURL(/\/admin\/sales\/[a-z0-9]{20,}$/, { timeout: 15_000 });
        return page.url().split("/").pop()!;
      }
      const first = await saveDraft();
      const second = await saveDraft();
      return [first, second];
    },
  );

  const outcome = await step(
    "[E] Confirm both drafts at nearly the same instant from two separate browser sessions",
    async () => {
      const contextA = await browser.newContext();
      const contextB = await browser.newContext();
      const pageA = await contextA.newPage();
      const pageB = await contextB.newPage();

      async function loginAndGoTo(p: typeof page, saleId: string) {
        await p.goto(`${BASE_URL}/login`);
        await p.getByLabel("Email").fill(email!);
        await p.getByLabel("Contraseña").fill(password!);
        await p.getByRole("button", { name: "Iniciar sesión" }).click();
        await expect(p).toHaveURL(/\/admin/, { timeout: 30_000 });
        await p.goto(`${BASE_URL}/admin/sales/${saleId}`);
        await expect(p.getByRole("button", { name: "Confirmar venta" })).toBeVisible({ timeout: 10_000 });
      }

      await loginAndGoTo(pageA, draftE1Id);
      await loginAndGoTo(pageB, draftE2Id);

      const results = await Promise.allSettled([
        pageA.getByRole("button", { name: "Confirmar venta" }).click().then(() =>
          expect(pageA.getByText("Confirmada", { exact: true })).toBeVisible({ timeout: 10_000 }),
        ),
        pageB.getByRole("button", { name: "Confirmar venta" }).click().then(() =>
          expect(pageB.getByText("Confirmada", { exact: true })).toBeVisible({ timeout: 10_000 }),
        ),
      ]);

      await contextA.close();
      await contextB.close();
      return results;
    },
  );

  await step("[E] Verify exactly one confirmation succeeded (server-side, via DB)", async () => {
    const [saleE1, saleE2] = await Promise.all([
      prisma.sale.findUniqueOrThrow({ where: { id: draftE1Id } }),
      prisma.sale.findUniqueOrThrow({ where: { id: draftE2Id } }),
    ]);
    const statuses = [saleE1.status, saleE2.status].sort();
    console.log("   sale statuses:", statuses, "| page outcomes:", outcome.map((r) => r.status));
    if (JSON.stringify(statuses) !== JSON.stringify(["CONFIRMED", "DRAFT"])) {
      throw new Error(`expected exactly one CONFIRMED and one still DRAFT, got ${statuses}`);
    }
  });

  await step("[E] Verify stock never went negative — exactly 0 remains", async () => {
    const balance = await getInventoryBalance(raceItem.variant.id, warehouse.id);
    if (balance?.quantity !== 0) throw new Error(`expected 0, got ${balance?.quantity}`);
  });

  console.log(
    `\nAll scenarios A-E passed. Test data left in place for review:\n` +
      `  ${main1.product.name} (${main1.product.id}) — sale A: ${saleAId} (CANCELLED), draft B: ${draftBId} (DRAFT)\n` +
      `  ${raceItem.product.name} (${raceItem.product.id}) — race drafts: ${draftE1Id}, ${draftE2Id}`,
  );
  await browser.close();
}

main().catch((error) => {
  console.error(
    "manual-sales-inventory-acceptance-flow failed:",
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
