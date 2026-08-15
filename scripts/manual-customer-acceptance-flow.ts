// The Customer Management Foundation phase's 22-step mandatory manual
// acceptance flow, scripted against the REAL running dev server
// (npm run dev:local, localhost:3000) and the REAL local postgres-dev
// database — not the isolated Docker test DB, and never Supabase. Creates
// one clearly-named customer ("Juan Pérez QA <timestamp>") and leaves it in
// place for human review, same convention as
// scripts/manual-acceptance-flow.ts. Never logs credentials. Ad hoc, not
// part of any npm script.
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

  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (err) => console.log("[PAGE ERROR]", err.message));
  page.on("response", (res) => {
    if (res.status() >= 500) console.log(`[HTTP ${res.status()}]`, res.url());
  });

  const runTag = Date.now();
  const lastName = `Pérez QA ${runTag}`;
  // The LAST 8 digits, not the first — Date.now()'s leading digits barely
  // change within a session (or across two nearby runs against
  // postgres-dev, which — unlike the Docker test DB — is never reset
  // between runs), so `${runTag}`.slice(0, 8) produced the same
  // "documentNumber" on every run and collided with the previous run's
  // leftover QA customer. Caught by this exact script against the real,
  // persistent dev database — never surfaced in the Docker-test-backed e2e
  // suite, which resets its database before every run.
  const documentNumber = String(runTag).slice(-8);
  const email2 = `juan-qa-${runTag}@example.com`;
  // Unique per run, not a fixed literal — a fixed phone would trigger the
  // (real, intended) soft-duplicate warning against a customer left behind
  // by a previous run of this same script, since phone is one of the two
  // soft-match signals (see modules/customers/customer-core.ts's
  // findPossibleDuplicateCustomers).
  const phone = `11 5555-${String(runTag).slice(-4)}`;

  // 1. Login as ADMIN.
  await step("1. Log in as ADMIN", async () => {
    await page.goto(`${BASE_URL}/login`);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill(password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/, { timeout: 30_000 });
  });

  // 2. Open Clientes.
  await step("2. Open Clientes", async () => {
    await page.getByRole("link", { name: "Clientes" }).click();
    await expect(page).toHaveURL(/\/admin\/customers$/, { timeout: 15_000 });
  });

  // 3-7. Create "Juan Pérez" with DNI, email, phone, and save.
  const customerId = await step("3-7. Create Juan Pérez with DNI, email, phone", async () => {
    await page.getByRole("link", { name: "Nuevo cliente" }).click();
    await expect(page).toHaveURL(/\/admin\/customers\/new/, { timeout: 15_000 });
    await page.getByLabel("Nombre").fill("Juan");
    await page.getByLabel("Apellido").fill(lastName);
    await page.getByLabel("Número de documento").fill(documentNumber);
    await page.getByLabel("Email (opcional)").fill(email2);
    await page.getByLabel("Teléfono (opcional)").fill(phone);
    await page.getByRole("button", { name: "Crear cliente" }).click();
    await expect(page).toHaveURL(/\/admin\/customers\/[a-z0-9]{20,}$/, { timeout: 15_000 });
    return page.url().split("/").pop()!;
  });
  console.log("   customerId:", customerId);

  // 8. Reach customer detail (already there after creation — confirm content).
  // .first(): the document number and email each appear twice on the page
  // (the compact header summary line, and again in their own detail card)
  // — real, intentional UI duplication, not a bug; .first() just avoids a
  // Playwright strict-mode ambiguity here.
  await step("8. Confirm customer detail page shows the new customer", async () => {
    await expect(page.getByRole("heading", { name: `Juan ${lastName}` })).toBeVisible();
    await expect(page.getByText(documentNumber).first()).toBeVisible();
    await expect(page.getByText(email2).first()).toBeVisible();
  });

  // 22. Confirm the customer page clearly says whether an online account is linked (checked here, adjacent to detail load).
  await step("22. Confirm the page clearly states no online account is linked", async () => {
    await expect(page.getByText("Cuenta online: No")).toBeVisible();
    await expect(page.getByText("Sin cuenta online")).toBeVisible();
  });

  // 21. Confirm a Customer can exist without an authenticated User (structural — verified via the DB directly).
  await step("21. Confirm the customer has no linkedUserId (exists without a User)", async () => {
    const { prisma } = await import("../src/lib/db-core");
    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    if (customer.linkedUserId !== null) {
      throw new Error("Expected linkedUserId to be null — customer should not require a User.");
    }
  });

  // 9. Add a shipping address.
  await step("9. Add a shipping address", async () => {
    await page.getByRole("button", { name: "Agregar dirección" }).click();
    await page.getByLabel("Calle").fill("Av. Corrientes");
    await page.getByLabel("Número").fill("1234");
    await page.getByLabel("Ciudad").fill("CABA");
    await page.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(page.getByText("Av. Corrientes 1234")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Envío predeterminado")).toBeVisible();
  });

  // 10. Edit that address.
  await step("10. Edit the address", async () => {
    await page.getByRole("button", { name: "Editar" }).click();
    await page.getByLabel("Piso (opcional)").fill("3");
    await page.getByRole("button", { name: "Guardar dirección" }).click();
    await expect(page.getByText("Av. Corrientes 1234, piso 3")).toBeVisible({ timeout: 10_000 });
  });

  // 11. Return to customer list.
  await step("11. Return to the customer list", async () => {
    await page.goto(`${BASE_URL}/admin/customers`);
    await expect(page).toHaveURL(/\/admin\/customers$/);
  });

  // 12-13. Search "Juan" and find the customer.
  await step('12-13. Search "Juan" and find the customer', async () => {
    await page.getByLabel("Buscar").fill("Juan");
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByRole("link", { name: `Juan ${lastName}` })).toBeVisible({
      timeout: 10_000,
    });
  });

  // 14-15. Search using DNI and find the same customer.
  await step("14-15. Search by DNI and find the same customer", async () => {
    await page.goto(`${BASE_URL}/admin/customers`);
    await page.getByLabel("Buscar").fill(documentNumber);
    await page.getByRole("button", { name: "Buscar" }).click();
    await expect(page.getByRole("link", { name: `Juan ${lastName}` })).toBeVisible({
      timeout: 10_000,
    });
  });

  // 16. Edit the customer.
  await step("16. Edit the customer", async () => {
    await page.goto(`${BASE_URL}/admin/customers/${customerId}/edit`);
    await page.getByLabel("Notas internas (opcional)").fill("Editado por el flujo de aceptación manual.");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/customers/${customerId}$`), { timeout: 15_000 });
    await expect(page.getByText("Editado por el flujo de aceptación manual.")).toBeVisible();
  });

  // 17-18. Trigger a duplicate warning with the same DNI and confirm no duplicate is silently created.
  await step("17-18. Attempt a second customer with the same DNI — confirm it's blocked, not silently created", async () => {
    const { prisma } = await import("../src/lib/db-core");
    const before = await prisma.customer.count({
      where: { documentType: "DNI", documentNumberNormalized: documentNumber },
    });

    await page.goto(`${BASE_URL}/admin/customers/new`);
    await page.getByLabel("Nombre").fill("Otro");
    await page.getByLabel("Apellido").fill("Distinto");
    await page.getByLabel("Número de documento").fill(documentNumber);
    await page.getByRole("button", { name: "Crear cliente" }).click();
    await expect(
      page.getByText("Ya existe un cliente con este número de documento."),
    ).toBeVisible({ timeout: 10_000 });

    const after = await prisma.customer.count({
      where: { documentType: "DNI", documentNumberNormalized: documentNumber },
    });
    if (after !== before) {
      throw new Error(`Expected customer count to stay ${before}, got ${after} — duplicate was created.`);
    }
  });

  // 19-20. Confirm Consumidor Final exists and cannot be deleted (no delete UI exists at all — verified structurally).
  await step("19-20. Confirm Consumidor Final exists and has no delete/edit UI", async () => {
    const { prisma } = await import("../src/lib/db-core");
    const consumidorFinal = await prisma.customer.findFirstOrThrow({
      where: { isSystemDefault: true },
    });
    await page.goto(`${BASE_URL}/admin/customers/${consumidorFinal.id}`);
    await expect(page.getByText("Cliente del sistema", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Eliminar/ })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "Editar cliente" })).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Desactivar cliente" })).not.toBeVisible();
  });

  console.log(`\nDone. Test customer left in place for review: Juan ${lastName} (${customerId})`);
  await browser.close();
}

main().catch((error) => {
  console.error("manual-customer-acceptance-flow failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
