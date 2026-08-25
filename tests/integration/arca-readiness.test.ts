// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { createCustomer } from "@/modules/customers/customer";
import {
  getArcaConnectionReadiness,
  getArcaDataReadiness,
  getArcaReadinessForSale,
  SaleNotFoundError,
  validateWsfeRequestReadiness,
} from "@/modules/fiscal-documents/arca";
import { createArcaInvoicingIntent } from "@/modules/fiscal-documents/fiscal-document";
import { adjustInventory } from "@/modules/inventory/service";
import { createProduct, createVariants } from "@/modules/products/service";
import { createSale } from "@/modules/sales/sale";
import { getStoreConfiguration, updateStoreConfiguration } from "@/modules/store-settings/service";
import { getDefaultWarehouse } from "@/modules/warehouses/service";

describe("ARCA readiness (real DB) — DATA READY vs. CONNECTION READY", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
    while (createdUserIds.length > 0) {
      const userId = createdUserIds.pop();
      if (userId) await deleteTestUser(userId);
    }
  });

  async function makeActor() {
    const actor = await createTestUser({
      name: "Arca Readiness Actor",
      email: `arca-readiness-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  async function clearIssuerProfileAfterTest(actorId: string) {
    const before = await getStoreConfiguration();
    cleanup.push(() =>
      updateStoreConfiguration(
        {
          fiscalLegalName: before.fiscalLegalName,
          fiscalTaxId: before.fiscalTaxId,
          issuerVatCondition: before.issuerVatCondition,
          arcaPointOfSale: before.arcaPointOfSale,
          arcaEnvironment: before.arcaEnvironment,
        },
        actorId,
      ),
    );
  }

  async function makeConfirmedSale(actorId: string, totalAmount: bigint, customerId: string) {
    const category = await createCategory({ name: `Arca Cat ${Date.now()}-${Math.random()}` }, actorId);
    const product = await createProduct(
      { name: `Arca Producto ${Date.now()}-${Math.random()}`, categoryId: category.id },
      actorId,
    );
    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `ARCA-SKU-${Date.now()}-${Math.random()}`, priceAmount: totalAmount }],
      actorId,
    );
    const warehouse = await getDefaultWarehouse();
    if (!warehouse) throw new Error("No default warehouse seeded — check reset-db.ts.");
    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouse.id,
      quantityDelta: 5,
      movementType: "INITIAL_STOCK",
      actorId,
    });
    return createSale(
      { customerId, items: [{ productVariantId: variant.id, quantity: 1 }], confirm: true },
      actorId,
    );
  }

  it("getArcaDataReadiness reports every missing field as its own blocker", async () => {
    const actor = await makeActor();
    await clearIssuerProfileAfterTest(actor.id);
    await updateStoreConfiguration(
      {
        fiscalLegalName: null,
        fiscalTaxId: null,
        issuerVatCondition: null,
        arcaPointOfSale: null,
        arcaEnvironment: null,
      },
      actor.id,
    );

    const readiness = await getArcaDataReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.map((b) => b.code).sort()).toEqual(
      [
        "MISSING_LEGAL_NAME",
        "MISSING_TAX_ID",
        "MISSING_ISSUER_VAT_CONDITION",
        "MISSING_POINT_OF_SALE",
        "MISSING_ENVIRONMENT",
      ].sort(),
    );
  });

  it("getArcaDataReadiness reports ready once every field is set", async () => {
    const actor = await makeActor();
    await clearIssuerProfileAfterTest(actor.id);
    await updateStoreConfiguration(
      {
        fiscalLegalName: "CHAIOBOUTIQUE S.R.L.",
        fiscalTaxId: "30-71234567-9",
        issuerVatCondition: "RESPONSABLE_INSCRIPTO",
        arcaPointOfSale: 1,
        arcaEnvironment: "HOMOLOGATION",
      },
      actor.id,
    );

    const readiness = await getArcaDataReadiness();
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it("getArcaConnectionReadiness reports MISSING_CERTIFICATE when HOMOLOGATION is selected but no certificate is configured", async () => {
    const actor = await makeActor();
    await clearIssuerProfileAfterTest(actor.id);
    await updateStoreConfiguration({ arcaEnvironment: "HOMOLOGATION" }, actor.id);

    // No ARCA_CERTIFICATE_PATH/ARCA_PRIVATE_KEY_PATH is set in this test
    // environment (see .env.example's own "leave blank to keep real ARCA
    // connectivity disabled" comment) — a real, deterministic "not
    // configured" state, not a mock.
    const readiness = await getArcaConnectionReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.map((b) => b.code)).toContain("MISSING_CERTIFICATE");
  });

  it("getArcaConnectionReadiness reports ENVIRONMENT_NOT_HOMOLOGATION when no environment is selected", async () => {
    const actor = await makeActor();
    await clearIssuerProfileAfterTest(actor.id);
    await updateStoreConfiguration({ arcaEnvironment: null }, actor.id);

    const readiness = await getArcaConnectionReadiness();
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.map((b) => b.code)).toContain("ENVIRONMENT_NOT_HOMOLOGATION");
  });

  it("getArcaReadinessForSale throws SaleNotFoundError for a nonexistent Sale", async () => {
    await expect(getArcaReadinessForSale("nonexistent-sale-id")).rejects.toThrow(SaleNotFoundError);
  });

  it("getArcaReadinessForSale surfaces a recipient-identification blocker for an unidentified customer above the RG 5700/2025 threshold", async () => {
    const actor = await makeActor();
    await clearIssuerProfileAfterTest(actor.id);
    await updateStoreConfiguration(
      {
        fiscalLegalName: "CHAIOBOUTIQUE S.R.L.",
        fiscalTaxId: "30-71234567-9",
        issuerVatCondition: "RESPONSABLE_INSCRIPTO",
        arcaPointOfSale: 1,
        arcaEnvironment: "HOMOLOGATION",
      },
      actor.id,
    );

    const customerResult = await createCustomer(
      { type: "PERSON", firstName: "Sin", lastName: `Identificar ${Date.now()}` },
      actor.id,
    );
    if (customerResult.status !== "created") throw new Error("unreachable");

    // Above the ARS 10.000.000 threshold, in minor units.
    const sale = await makeConfirmedSale(actor.id, 1_000_000_001n, customerResult.customer.id);

    const readiness = await getArcaReadinessForSale(sale.id);
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.some((b) => b.code === "RECIPIENT_IDENTIFICATION_REQUIRED")).toBe(true);
  });

  it("getArcaReadinessForSale is ready for a small Sale to an unclassified customer (Consumidor Final, no identification required)", async () => {
    const actor = await makeActor();
    await clearIssuerProfileAfterTest(actor.id);
    await updateStoreConfiguration(
      {
        fiscalLegalName: "CHAIOBOUTIQUE S.R.L.",
        fiscalTaxId: "30-71234567-9",
        issuerVatCondition: "RESPONSABLE_INSCRIPTO",
        arcaPointOfSale: 1,
        arcaEnvironment: "HOMOLOGATION",
      },
      actor.id,
    );

    const customerResult = await createCustomer(
      { type: "PERSON", firstName: "Consumidor", lastName: `Final ${Date.now()}` },
      actor.id,
    );
    if (customerResult.status !== "created") throw new Error("unreachable");

    const sale = await makeConfirmedSale(actor.id, 50_000n, customerResult.customer.id);

    const readiness = await getArcaReadinessForSale(sale.id);
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it("validateWsfeRequestReadiness requires an actual PENDING ELECTRONICA_ARCA intent to exist", async () => {
    const actor = await makeActor();
    await clearIssuerProfileAfterTest(actor.id);
    await updateStoreConfiguration(
      {
        fiscalLegalName: "CHAIOBOUTIQUE S.R.L.",
        fiscalTaxId: "30-71234567-9",
        issuerVatCondition: "RESPONSABLE_INSCRIPTO",
        arcaPointOfSale: 1,
        arcaEnvironment: "HOMOLOGATION",
      },
      actor.id,
    );

    const customerResult = await createCustomer(
      { type: "PERSON", firstName: "Sin", lastName: `Intento ${Date.now()}` },
      actor.id,
    );
    if (customerResult.status !== "created") throw new Error("unreachable");
    const sale = await makeConfirmedSale(actor.id, 30_000n, customerResult.customer.id);

    const withoutIntent = await validateWsfeRequestReadiness(sale.id);
    expect(withoutIntent.ready).toBe(false);
    expect(withoutIntent.blockers.some((b) => b.code === "NO_PENDING_ARCA_INTENT")).toBe(true);

    await createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id);
    cleanup.push(() => prisma.fiscalDocument.deleteMany({ where: { saleId: sale.id } }));

    const withIntent = await validateWsfeRequestReadiness(sale.id);
    expect(withIntent.ready).toBe(true);
  });

  it("Customer.vatCondition round-trips through createCustomer/updateCustomer without touching the legacy taxCondition field", async () => {
    const actor = await makeActor();
    const result = await createCustomer(
      {
        type: "PERSON",
        firstName: "Vat",
        lastName: `Condition ${Date.now()}`,
        taxCondition: "Responsable Inscripto (texto libre histórico)",
        vatCondition: "RESPONSABLE_INSCRIPTO",
      },
      actor.id,
    );
    if (result.status !== "created") throw new Error("unreachable");

    expect(result.customer.vatCondition).toBe("RESPONSABLE_INSCRIPTO");
    expect(result.customer.taxCondition).toBe("Responsable Inscripto (texto libre histórico)");
  });
});
