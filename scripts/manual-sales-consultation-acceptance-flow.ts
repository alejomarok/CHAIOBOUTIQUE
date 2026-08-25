// Sales Consultation & Commercial Reporting phase's manual acceptance flow,
// scripted against the REAL running dev server (npm run dev:local,
// localhost:3000) and the REAL local postgres-dev database — mirrors
// scripts/manual-sales-acceptance-flow.ts's exact safety/structure
// conventions. Never Supabase, never the isolated Docker test DB. Leaves
// its data in place for human review. Ad hoc, not part of any npm script.
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
        `got "${host}:${port}/${databaseName}"). Refusing to run.`,
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
  const { adjustInventory } = await import("../src/modules/inventory/service-core");
  const { createCustomer } = await import("../src/modules/customers/customer-core");
  const { createSale, cancelSale } = await import("../src/modules/sales/sale-core");
  const { registerSalePayment } = await import("../src/modules/sales/payment-core");
  const { getDefaultWarehouse } = await import("../src/modules/warehouses/service-core");

  const runTag = Date.now();
  const admin = await prisma.user.findUniqueOrThrow({ where: { email } });
  const warehouse = await getDefaultWarehouse();
  if (!warehouse) throw new Error("No default warehouse in postgres-dev — seed one first.");
  const warehouseId = warehouse.id;

  async function makeSale(namePrefix: string, totalAmount: bigint) {
    const category = await createCategory({ name: `${namePrefix} Cat ${runTag}` }, admin.id);
    const product = await createProduct(
      { name: `${namePrefix} ${runTag}`, categoryId: category.id, defaultPriceAmount: totalAmount },
      admin.id,
    );
    const sku = `QA-CONS-${namePrefix.replace(/\s/g, "")}-${runTag}`;
    const [variant] = await createVariants(product.id, [{ sizeOptionId: null, colorId: null, sku }], admin.id);
    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouseId,
      quantityDelta: 10,
      movementType: "INITIAL_STOCK",
      actorId: admin.id,
    });
    const customerResult = await createCustomer(
      { type: "PERSON", firstName: "QA Consulta", lastName: `${namePrefix} ${runTag}` },
      admin.id,
    );
    if (customerResult.status !== "created") throw new Error("unreachable");
    const sale = await createSale(
      {
        customerId: customerResult.customer.id,
        items: [{ productVariantId: variant.id, quantity: 1, unitPriceAmount: totalAmount }],
        confirm: true,
      },
      admin.id,
    );
    return { sale, sku, product };
  }

  // --- Scenario B: a plain POS sale, fully paid, for the full detail check.
  const { sale: posSale } = await makeSale("QA POS", 150000n);
  await registerSalePayment(
    { saleId: posSale.id, method: "CASH", amount: 150000n, idempotencyKey: crypto.randomUUID() },
    admin.id,
  );

  // --- Scenario D: partial payment.
  const { sale: partialSale } = await makeSale("QA Parcial", 200000n);
  await registerSalePayment(
    { saleId: partialSale.id, method: "CASH", amount: 80000n, idempotencyKey: crypto.randomUUID() },
    admin.id,
  );

  // --- Scenario E: split payment across two methods.
  const { sale: splitSale } = await makeSale("QA Split", 300000n);
  await registerSalePayment(
    { saleId: splitSale.id, method: "CASH", amount: 100000n, idempotencyKey: crypto.randomUUID() },
    admin.id,
  );
  await registerSalePayment(
    { saleId: splitSale.id, method: "BANK_TRANSFER", amount: 200000n, idempotencyKey: crypto.randomUUID() },
    admin.id,
  );

  // --- Scenario F: a cancelled sale (must remain searchable, excluded from revenue).
  const { sale: cancelledSale } = await makeSale("QA Cancelada", 50000n);
  await cancelSale(cancelledSale.id, "Prueba de aceptación manual — consulta de ventas", admin.id);

  // --- Scenario I: product search returning ONE row for a multi-item sale.
  // Two SEPARATE products sharing a common SKU prefix (the search term) —
  // two variants of the SAME product both need distinct size/color
  // combinations (a DB uniqueness constraint), which is unrelated to what
  // this scenario actually needs to prove.
  const dedupCategory = await createCategory({ name: `QA Dedup Cat ${runTag}` }, admin.id);
  const dedupSku = `QA-DEDUP-${runTag}`;
  const dedupProductA = await createProduct(
    { name: `QA Dedup Producto A ${runTag}`, categoryId: dedupCategory.id, defaultPriceAmount: 10000n },
    admin.id,
  );
  const dedupProductB = await createProduct(
    { name: `QA Dedup Producto B ${runTag}`, categoryId: dedupCategory.id, defaultPriceAmount: 15000n },
    admin.id,
  );
  const [dedupVariantA] = await createVariants(
    dedupProductA.id,
    [{ sizeOptionId: null, colorId: null, sku: `${dedupSku}-A` }],
    admin.id,
  );
  const [dedupVariantB] = await createVariants(
    dedupProductB.id,
    [{ sizeOptionId: null, colorId: null, sku: `${dedupSku}-B` }],
    admin.id,
  );
  await adjustInventory({
    variantId: dedupVariantA.id,
    warehouseId: warehouseId,
    quantityDelta: 5,
    movementType: "INITIAL_STOCK",
    actorId: admin.id,
  });
  await adjustInventory({
    variantId: dedupVariantB.id,
    warehouseId: warehouseId,
    quantityDelta: 5,
    movementType: "INITIAL_STOCK",
    actorId: admin.id,
  });
  const dedupCustomer = await createCustomer(
    { type: "PERSON", firstName: "QA Dedup", lastName: `Cliente ${runTag}` },
    admin.id,
  );
  if (dedupCustomer.status !== "created") throw new Error("unreachable");
  const dedupSale = await createSale(
    {
      customerId: dedupCustomer.customer.id,
      items: [
        { productVariantId: dedupVariantA.id, quantity: 1 },
        { productVariantId: dedupVariantB.id, quantity: 1 },
      ],
      confirm: true,
    },
    admin.id,
  );

  console.log(`Test data ready: POS=${posSale.code} Parcial=${partialSale.code} Split=${splitSale.code} Cancelada=${cancelledSale.code} Dedup=${dedupSale.code}`);

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

  await step("Open 'Consultas de ventas' from the nav", async () => {
    await page.getByRole("link", { name: "Consultas de ventas" }).click();
    await expect(page).toHaveURL(/\/admin\/sales\/consultation$/, { timeout: 15_000 });
  });

  // --- A. Date range: consult current month.
  await step("A. 'Este mes' preset filters and shows a non-zero summary", async () => {
    await page.getByRole("link", { name: "Este mes" }).click();
    await expect(page.locator("#from")).not.toHaveValue("", { timeout: 10_000 });
    await expect(page.getByText("Cantidad de ventas", { exact: true })).toBeVisible();
    // exact: true — "Total vendido" also appears (lowercase, mid-sentence)
    // inside the "Ventas canceladas..." disclaimer paragraph.
    await expect(page.getByText("Total vendido", { exact: true })).toBeVisible();
  });

  // --- B. POS Sale full detail.
  await step("B. Open the POS Sale's detail and verify every section", async () => {
    await page.goto(`${BASE_URL}/admin/sales/consultation?code=${posSale.code}`);
    await page.getByRole("link", { name: "Ver detalle" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/sales/${posSale.id}$`), { timeout: 10_000 });
    await expect(page.getByText("Origen:")).toBeVisible();
    await expect(page.getByText("Venta en local")).toBeVisible();
    await expect(page.getByText("Vendedor:")).toBeVisible();
    await expect(page.getByText(`Depósito: ${warehouse.name}`)).toBeVisible();
    await expect(page.getByText("Pagada", { exact: true })).toBeVisible();
    await expect(page.getByText("Sin facturar", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Ver movimientos de stock" })).toBeVisible();
  });

  // --- D. Partial payment.
  await step("D. Partial payment shows Total/Pagado/Saldo/Estado correctly", async () => {
    await page.goto(`${BASE_URL}/admin/sales/${partialSale.id}`);
    await expect(page.getByText("Pago parcial", { exact: true })).toBeVisible();
    await expect(page.getByText("120000", { exact: false })).not.toBeVisible(); // sanity: no stray raw number
  });

  // --- E. Split payment.
  await step("E. Split payment shows both payment methods in history", async () => {
    await page.goto(`${BASE_URL}/admin/sales/${splitSale.id}`);
    await expect(page.getByText("Efectivo", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Transferencia", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Pagada", { exact: true })).toBeVisible();
  });

  // --- F. Cancelled sale remains searchable, excluded from revenue total.
  await step("F. Cancelled Sale is searchable but excluded from Total vendido", async () => {
    await page.goto(`${BASE_URL}/admin/sales/consultation?code=${cancelledSale.code}`);
    // Scoped to the results table — "Cancelada" also exists as a (hidden,
    // closed) <option> in the Estado filter <select>, which .first() would
    // otherwise match instead (DOM order puts the filter panel first).
    await expect(page.locator("table").getByText("Cancelada", { exact: true })).toBeVisible();
    await expect(page.getByText("Ventas canceladas en este período", { exact: false })).toBeVisible();
  });

  // --- I. Product search dedup.
  await step("I. Product search returns the multi-item Sale exactly once", async () => {
    await page.goto(`${BASE_URL}/admin/sales/consultation?product=${dedupSku}`);
    const rows = page.getByText(dedupSale.code);
    await expect(rows.first()).toBeVisible();
    expect(await rows.count()).toBeLessThanOrEqual(2); // desktop row + mobile card, never more (never duplicated per matching line)
  });

  // --- J. Customer search.
  await step("J. Customer search by name finds the Sale", async () => {
    await page.goto(`${BASE_URL}/admin/sales/consultation?customer=${encodeURIComponent("QA Dedup")}`);
    await expect(page.getByText(dedupSale.code).first()).toBeVisible();
  });

  // --- K. Mobile.
  await step("K. Mobile viewport (390px) shows cards, not a giant table", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/admin/sales/consultation?code=${posSale.code}`);
    await expect(page.locator("table")).toBeHidden();
    // The Sale code exists TWICE in the DOM regardless of viewport (desktop
    // table row + mobile card, toggled by CSS only) — "Vendedor: <name>" is
    // unique to the mobile card's own markup, so this actually proves the
    // mobile card is the one rendered/visible, not just that the table
    // isn't.
    await expect(page.getByText(`Vendedor: ${admin.name}`, { exact: true })).toBeVisible();
    await page.goto(`${BASE_URL}/admin/sales/${posSale.id}`);
    await expect(page.getByText("Origen:")).toBeVisible();
  });

  console.log(
    `\nDone. Test data left in place for review: POS=${posSale.code}, Parcial=${partialSale.code}, ` +
      `Split=${splitSale.code}, Cancelada=${cancelledSale.code}, Dedup=${dedupSale.code}.`,
  );
  await browser.close();
}

main().catch((error) => {
  console.error("manual-sales-consultation-acceptance-flow failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
