import { expect, test } from "@playwright/test";

import "../integration/guard";

import { prisma } from "@/lib/db-core";
import { runCleanup } from "../fixtures/cleanup";
import { createCategory } from "@/modules/categories/service-core";
import { createCustomer } from "@/modules/customers/customer-core";
import { adjustInventory } from "@/modules/inventory/service-core";
import { createProduct, createVariants } from "@/modules/products/service-core";
import { createSale } from "@/modules/sales/sale-core";
import { getDefaultWarehouse } from "@/modules/warehouses/service-core";

import { ADMIN_FIXTURE } from "./fixture-credentials";

// The admin invoicing UI flow, over real HTTP against the isolated Docker
// test database — proves the "Facturación" section, the step-1/step-2
// registration dialog, and the cancellation-block interlock genuinely work
// end-to-end (see tests/integration/fiscal-documents.test.ts for the
// finer-grained business-rule coverage).
test.describe("fiscal invoicing (real DB, real HTTP)", () => {
  const cleanup: Array<() => Promise<unknown>> = [];

  test.afterEach(async () => {
    await runCleanup(cleanup);
  });

  async function makeConfirmedSale(namePrefix: string, totalAmount: bigint) {
    const actor = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_FIXTURE.email } });
    const category = await createCategory({ name: `${namePrefix} Cat ${Date.now()}` }, actor.id);
    const product = await createProduct(
      { name: `${namePrefix} ${Date.now()}`, categoryId: category.id, defaultPriceAmount: totalAmount },
      actor.id,
    );
    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `${namePrefix.toUpperCase()}-${Date.now()}` }],
      actor.id,
    );
    const warehouse = await getDefaultWarehouse();
    if (!warehouse) throw new Error("No default warehouse seeded — check reset-db.ts.");
    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouse.id,
      quantityDelta: 10,
      movementType: "INITIAL_STOCK",
      actorId: actor.id,
    });
    const customerResult = await createCustomer(
      { type: "PERSON", firstName: "Factura", lastName: `E2E ${Date.now()}` },
      actor.id,
    );
    if (customerResult.status !== "created") throw new Error("unreachable");
    const sale = await createSale(
      {
        customerId: customerResult.customer.id,
        items: [{ productVariantId: variant.id, quantity: 1, unitPriceAmount: totalAmount }],
        confirm: true,
      },
      actor.id,
    );
    return sale;
  }

  async function loginAsAdmin(page: import("@playwright/test").Page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ADMIN_FIXTURE.email);
    await page.getByLabel("Contraseña").fill(ADMIN_FIXTURE.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page).toHaveURL(/\/admin/);
  }

  test("an uninvoiced confirmed sale shows Sin facturar", async ({ page }) => {
    const sale = await makeConfirmedSale("Fiscal Uninvoiced", 100000n);
    cleanup.push(async () => {
      await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
      await prisma.sale.delete({ where: { id: sale.id } });
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/sales/${sale.id}`);
    await expect(page.getByText("Sin facturar")).toBeVisible();
    await expect(page.getByRole("button", { name: "Registrar facturación" })).toBeVisible();
  });

  test("registers a manual invoice through the two-step dialog, then blocks cancellation, then unblocks it after voiding", async ({
    page,
  }) => {
    const sale = await makeConfirmedSale("Fiscal Manual", 150000n);
    cleanup.push(async () => {
      await prisma.fiscalDocument.deleteMany({ where: { saleId: sale.id } });
      await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
      await prisma.sale.deleteMany({ where: { id: sale.id } });
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/sales/${sale.id}`);

    // Step 1: "¿Cómo se facturó esta venta?"
    await page.getByRole("button", { name: "Registrar facturación" }).click();
    await expect(page.getByText("¿Cómo se facturó esta venta?")).toBeVisible();
    await page.getByRole("button", { name: "Manualmente" }).click();

    // Step 2: the real manual data-entry form.
    await page.getByLabel("Tipo de comprobante").fill("Factura B");
    await page.getByLabel("Punto de venta").fill("0004");
    await page.getByLabel("Número de comprobante").fill(`E2E-${Date.now()}`);
    // Total is pre-filled with the Sale's own authoritative total — left
    // unchanged, proving the happy path works without the admin having to
    // re-type it.
    await page.getByRole("button", { name: "Registrar comprobante" }).click();

    await expect(page.getByText("Comprobante manual registrado.")).toBeVisible();
    await expect(page.getByText("Facturada", { exact: true })).toBeVisible();
    await expect(page.getByText("Comprobante manual", { exact: true })).toBeVisible();

    // Cancellation is now blocked server-side.
    await page.getByRole("button", { name: "Cancelar venta" }).click();
    await page.getByPlaceholder(/Motivo de cancelaci/).fill("prueba e2e");
    await page.getByRole("button", { name: "Confirmar cancelación" }).click();
    await expect(
      page.getByText("Esta venta ya tiene un comprobante fiscal registrado."),
    ).toBeVisible({ timeout: 10_000 });

    const stillConfirmed = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(stillConfirmed.status).toBe("CONFIRMED");

    // Void the fiscal document — the administrative correction path.
    await page.getByRole("button", { name: "Anular comprobante" }).click();
    await page.getByPlaceholder(/Motivo de anulaci/).fill("error de carga e2e");
    await page.getByRole("button", { name: "Confirmar anulación" }).click();
    await expect(page.getByText("Comprobante anulado.")).toBeVisible();
    await expect(page.getByText("Sin facturar")).toBeVisible();

    // Cancellation now succeeds — CancelSaleButton stayed in its
    // "confirming" state after the earlier blocked attempt (never resets
    // on error), so this is a direct re-confirm, not the full flow again.
    await page.getByRole("button", { name: "Confirmar cancelación" }).click();
    await expect(page.getByText("Cancelada", { exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("ELECTRONICA_ARCA registers only a pending intent and clearly states ARCA is not yet enabled", async ({
    page,
  }) => {
    const sale = await makeConfirmedSale("Fiscal Arca", 50000n);
    cleanup.push(async () => {
      await prisma.fiscalDocument.deleteMany({ where: { saleId: sale.id } });
      await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
      await prisma.sale.deleteMany({ where: { id: sale.id } });
    });

    // createArcaInvoicingIntent now gates on the store's own DATA readiness
    // (Phase — ARCA Fiscal Readiness + Tax Model) — a fresh test DB starts
    // with no issuer fiscal profile configured, so this test configures a
    // complete one first, then restores the original values afterward
    // (StoreConfiguration is a single shared row across the whole suite).
    const beforeConfig = await prisma.storeConfiguration.findUniqueOrThrow({ where: { id: "main" } });
    cleanup.push(async () => {
      await prisma.storeConfiguration.update({
        where: { id: "main" },
        data: {
          fiscalLegalName: beforeConfig.fiscalLegalName,
          fiscalTaxId: beforeConfig.fiscalTaxId,
          issuerVatCondition: beforeConfig.issuerVatCondition,
          arcaPointOfSale: beforeConfig.arcaPointOfSale,
          arcaEnvironment: beforeConfig.arcaEnvironment,
        },
      });
    });
    await prisma.storeConfiguration.update({
      where: { id: "main" },
      data: {
        fiscalLegalName: "CHAIOBOUTIQUE S.R.L.",
        fiscalTaxId: "30-71234567-9",
        issuerVatCondition: "RESPONSABLE_INSCRIPTO",
        arcaPointOfSale: 1,
        arcaEnvironment: "HOMOLOGATION",
      },
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/sales/${sale.id}`);

    await page.getByRole("button", { name: "Registrar facturación" }).click();
    await page.getByRole("button", { name: "Electrónicamente con ARCA" }).click();
    await expect(page.getByText("todavía no está habilitada")).toBeVisible();
    await page.getByRole("button", { name: "Registrar intención" }).click();
    await expect(page.getByText("Se registró la intención de facturación electrónica.")).toBeVisible();

    // Phase — Sales Consultation & Commercial Reporting: an ELECTRONICA_ARCA
    // PENDING intent now shows the more specific "Pendiente de emisión
    // ARCA" wording on the Sale detail page, not bare "Pendiente" — see
    // that page's own Facturación card.
    await expect(page.getByText("Pendiente de emisión ARCA", { exact: true })).toBeVisible();
    const document = await prisma.fiscalDocument.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(document.mode).toBe("ELECTRONICA_ARCA");
    expect(document.status).toBe("PENDING");
    expect(document.cae).toBeNull();
  });

  // Phase — ARCA Homologation: Real WSAA + WSFEv1 Integration. The e2e
  // webServer runs with E2E_TEST_MODE=true (playwright.config.ts), which
  // makes getArcaAuthProvider()/getArcaElectronicInvoiceProvider() select
  // their Fake implementations AND getArcaConnectionReadiness() report
  // ready without a real certificate (see readiness-core.ts's own
  // E2E_TEST_MODE bypass) — this proves the real "Emitir en ARCA —
  // Homologación" UI/Server Action/persistence wiring genuinely works
  // end-to-end over real HTTP, without ever touching real ARCA. The
  // deeper numbering/concurrency/reconciliation guarantees are covered by
  // tests/integration/arca-electronic-invoice.test.ts.
  test("issues a real electronic invoice via 'Emitir en ARCA — Homologación', showing the HOMOLOGACIÓN watermark and CAE", async ({
    page,
  }) => {
    // Issuer profile (including defaultTaxCategory) must be configured
    // BEFORE the Sale is created — SaleItem.taxCategory is snapshotted at
    // Sale-creation time from StoreConfiguration.defaultTaxCategory, never
    // backfilled later (see fiscal-tax-category-core.ts's own "historical
    // fiscal documents must not change" posture). Configuring it after
    // creating the Sale would leave the SaleItem with no tax category at
    // all, and issuance would refuse with MissingLineTaxCategoryError.
    const beforeConfig = await prisma.storeConfiguration.findUniqueOrThrow({ where: { id: "main" } });
    cleanup.push(async () => {
      await prisma.storeConfiguration.update({
        where: { id: "main" },
        data: {
          fiscalLegalName: beforeConfig.fiscalLegalName,
          fiscalTaxId: beforeConfig.fiscalTaxId,
          issuerVatCondition: beforeConfig.issuerVatCondition,
          arcaPointOfSale: beforeConfig.arcaPointOfSale,
          arcaEnvironment: beforeConfig.arcaEnvironment,
          defaultTaxCategory: beforeConfig.defaultTaxCategory,
        },
      });
    });
    await prisma.storeConfiguration.update({
      where: { id: "main" },
      data: {
        fiscalLegalName: "CHAIOBOUTIQUE S.R.L.",
        fiscalTaxId: "30-71234567-9",
        issuerVatCondition: "RESPONSABLE_INSCRIPTO",
        // A point of sale unique to this test — the Fake provider's
        // in-process numbering state is keyed by pointOfSale+CbteTipo, so
        // reusing a value another test already issued against would start
        // from a non-zero voucher number.
        arcaPointOfSale: 940_001,
        arcaEnvironment: "HOMOLOGATION",
        defaultTaxCategory: "IVA_21",
      },
    });

    const sale = await makeConfirmedSale("Fiscal Arca Issue", 121000n);
    cleanup.push(async () => {
      await prisma.fiscalDocument.deleteMany({ where: { saleId: sale.id } });
      await prisma.saleItem.deleteMany({ where: { saleId: sale.id } });
      await prisma.sale.deleteMany({ where: { id: sale.id } });
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/sales/${sale.id}`);
    await page.getByRole("button", { name: "Registrar facturación" }).click();
    await page.getByRole("button", { name: "Electrónicamente con ARCA" }).click();
    await page.getByRole("button", { name: "Registrar intención" }).click();
    await expect(page.getByText("Se registró la intención de facturación electrónica.")).toBeVisible();

    await page.getByRole("button", { name: "Emitir en ARCA — Homologación" }).click();
    await expect(page.getByText("No es una simulación")).toBeVisible();
    await page.getByRole("button", { name: "Confirmar emisión" }).click();

    await expect(page.getByText("Comprobante emitido en ARCA (Homologación).")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("dialog").getByText("Comprobante emitido")).toBeVisible();
    await expect(page.getByRole("dialog").getByText("HOMOLOGACIÓN", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Cerrar" }).click();

    // Persisted on the page itself after the dialog closes.
    await expect(page.getByText("Facturada", { exact: true })).toBeVisible();
    await expect(
      page
        .locator("[data-slot='card-title']")
        .filter({ hasText: "Facturación" })
        .getByText("HOMOLOGACIÓN", { exact: true }),
    ).toBeVisible();

    const issued = await prisma.fiscalDocument.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(issued.status).toBe("ISSUED");
    expect(issued.cae).toBeTruthy();
    expect(issued.arcaEnvironment).toBe("HOMOLOGATION");
  });
});
