// @vitest-environment node
import "./guard";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { createCustomer } from "@/modules/customers/customer";
import {
  ArcaIssuanceNotReadyError,
  ArcaIssuanceUncertainError,
  FakeArcaAuthProvider,
  FakeArcaElectronicInvoiceProvider,
  FiscalDocumentNotReconcilableError,
  issueElectronicInvoice,
  reconcileArcaFiscalDocument,
  setArcaAuthProviderForTesting,
  setArcaConnectionReadinessForTesting,
  setArcaElectronicInvoiceProviderForTesting,
} from "@/modules/fiscal-documents/arca";
import { ARCA_CBTE_TIPO_CODE } from "@/modules/fiscal-documents/arca/arca-codes";
import {
  createArcaInvoicingIntent,
  registerManualFiscalDocument,
} from "@/modules/fiscal-documents/fiscal-document";
import { SaleHasFiscalDocumentError, cancelSale } from "@/modules/sales/sale";
import { adjustInventory } from "@/modules/inventory/service";
import { createProduct, createVariants } from "@/modules/products/service";
import { createSale } from "@/modules/sales/sale";
import { getStoreConfiguration, updateStoreConfiguration } from "@/modules/store-settings/service";
import { getDefaultWarehouse } from "@/modules/warehouses/service";

// Real WSAA + WSFEv1 issuance flow (modules/fiscal-documents/arca/
// issue-electronic-invoice-core.ts), exercised end to end against a REAL
// Postgres transaction/advisory-lock but ONLY the Fake WSAA/WSFEv1
// providers — see this phase's explicit "never real ARCA, no certificate
// required for the normal suite" requirement. Connection readiness is
// overridden via setArcaConnectionReadinessForTesting (this test
// environment genuinely has no certificate on disk — see
// tests/integration/arca-readiness.test.ts for that real, unmocked check).
describe("ARCA electronic invoice issuance (real DB, Fake WSAA/WSFEv1)", () => {
  const createdUserIds: string[] = [];
  const cleanup: Array<() => Promise<unknown>> = [];
  let fakeInvoiceProvider: FakeArcaElectronicInvoiceProvider;

  beforeEach(() => {
    fakeInvoiceProvider = new FakeArcaElectronicInvoiceProvider();
    setArcaElectronicInvoiceProviderForTesting(fakeInvoiceProvider);
    setArcaAuthProviderForTesting(new FakeArcaAuthProvider());
    setArcaConnectionReadinessForTesting({ ready: true, blockers: [] });
  });

  afterEach(async () => {
    setArcaElectronicInvoiceProviderForTesting(null);
    setArcaAuthProviderForTesting(null);
    setArcaConnectionReadinessForTesting(null);
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
      name: "Arca Issuance Actor",
      email: `arca-issuance-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  // Sets a fully DATA-READY issuer fiscal profile with a real
  // defaultTaxCategory (required: FACTURA_A/B decomposition throws
  // MissingLineTaxCategoryError without one — see tax-calculation-core.ts)
  // — restored via `cleanup`, same convention as fiscal-documents.test.ts's
  // own configureCompleteIssuerProfile.
  async function configureIssuerProfile(actorId: string, pointOfSale: number) {
    const before = await getStoreConfiguration();
    cleanup.push(() =>
      updateStoreConfiguration(
        {
          fiscalLegalName: before.fiscalLegalName,
          fiscalTaxId: before.fiscalTaxId,
          issuerVatCondition: before.issuerVatCondition,
          arcaPointOfSale: before.arcaPointOfSale,
          arcaEnvironment: before.arcaEnvironment,
          defaultTaxCategory: before.defaultTaxCategory,
        },
        actorId,
      ),
    );
    await updateStoreConfiguration(
      {
        fiscalLegalName: "CHAIOBOUTIQUE S.R.L.",
        fiscalTaxId: "30-71234567-9",
        issuerVatCondition: "RESPONSABLE_INSCRIPTO",
        arcaPointOfSale: pointOfSale,
        arcaEnvironment: "HOMOLOGATION",
        defaultTaxCategory: "IVA_21",
      },
      actorId,
    );
  }

  async function makeConfirmedSale(actorId: string, totalAmount = 121000n) {
    const category = await createCategory({ name: `Arca Issue Cat ${Date.now()}-${Math.random()}` }, actorId);
    const product = await createProduct(
      { name: `Arca Issue Producto ${Date.now()}-${Math.random()}`, categoryId: category.id },
      actorId,
    );
    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `ARCA-ISSUE-${Date.now()}-${Math.random()}`, priceAmount: totalAmount }],
      actorId,
    );
    const warehouse = await getDefaultWarehouse();
    if (!warehouse) throw new Error("No default warehouse seeded — check reset-db.ts.");
    await adjustInventory({
      variantId: variant.id,
      warehouseId: warehouse.id,
      quantityDelta: 10,
      movementType: "INITIAL_STOCK",
      actorId,
    });
    const customerResult = await createCustomer(
      {
        type: "PERSON",
        firstName: "Cliente",
        lastName: `Issue ${Date.now()}-${Math.random()}`,
        documentType: "DNI",
        documentNumber: `${Math.floor(10000000 + Math.random() * 89999999)}`,
      },
      actorId,
    );
    if (customerResult.status !== "created") throw new Error("unreachable");
    return createSale(
      { customerId: customerResult.customer.id, items: [{ productVariantId: variant.id, quantity: 1 }], confirm: true },
      actorId,
    );
  }

  it("issues a real electronic invoice end-to-end via Fake WSAA + WSFEv1 — Factura B, single VAT rate", async () => {
    const actor = await makeActor();
    await configureIssuerProfile(actor.id, 900_001);
    const sale = await makeConfirmedSale(actor.id, 121000n);
    const intent = await createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id);

    const issued = await issueElectronicInvoice(sale.id, actor.id);

    expect(issued.id).toBe(intent.id);
    expect(issued.status).toBe("ISSUED");
    expect(issued.mode).toBe("ELECTRONICA_ARCA");
    expect(issued.documentNumber).toBe("1");
    expect(issued.pointOfSale).toBe("900001");
    expect(issued.cae).toBeTruthy();
    expect(issued.caeExpiresAt).toBeInstanceOf(Date);
    expect(issued.arcaEnvironment).toBe("HOMOLOGATION");
    // BigInt-exact: net + tax + exempt === gross, always (see
    // tax-calculation-core.ts's own invariant).
    expect(issued.netAmount! + issued.taxAmount! + issued.exemptAmount!).toBe(issued.totalAmount);
    expect(issued.totalAmount).toBe(121000n);
    const breakdown = issued.arcaTaxBreakdown as Array<{ rateBasisPoints: number }>;
    expect(breakdown).toHaveLength(1);
    expect(breakdown[0].rateBasisPoints).toBe(2100);
  });

  it("is idempotent — issuing twice for the same Sale returns the same ISSUED row without a second CAE request", async () => {
    const actor = await makeActor();
    await configureIssuerProfile(actor.id, 900_002);
    const sale = await makeConfirmedSale(actor.id);
    await createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id);

    const first = await issueElectronicInvoice(sale.id, actor.id);
    const second = await issueElectronicInvoice(sale.id, actor.id);

    expect(second.id).toBe(first.id);
    expect(second.cae).toBe(first.cae);
    expect(second.documentNumber).toBe(first.documentNumber);
    expect(fakeInvoiceProvider.getRequestCaeCallCountForTesting()).toBe(1);
  });

  it("a REJECTED outcome marks the FiscalDocument ERROR with persisted observations, never ISSUED", async () => {
    const actor = await makeActor();
    await configureIssuerProfile(actor.id, 900_003);
    const sale = await makeConfirmedSale(actor.id);
    await createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id);
    fakeInvoiceProvider.forceNextRequestRejectedForTesting();

    const result = await issueElectronicInvoice(sale.id, actor.id);

    expect(result.status).toBe("ERROR");
    expect(result.cae).toBeNull();
    expect(result.documentNumber).toBeNull();
    const metadata = result.arcaResponseMetadata as { status: string; errors: Array<{ code: string }> };
    expect(metadata.status).toBe("REJECTED");
    expect(metadata.errors.length).toBeGreaterThan(0);
  });

  it("two different Sales issuing concurrently against the same point of sale + document type never collide on numbering", async () => {
    const actor = await makeActor();
    await configureIssuerProfile(actor.id, 900_004);
    const saleA = await makeConfirmedSale(actor.id);
    const saleB = await makeConfirmedSale(actor.id);
    await createArcaInvoicingIntent({ saleId: saleA.id, idempotencyKey: crypto.randomUUID() }, actor.id);
    await createArcaInvoicingIntent({ saleId: saleB.id, idempotencyKey: crypto.randomUUID() }, actor.id);

    const [resultA, resultB] = await Promise.all([
      issueElectronicInvoice(saleA.id, actor.id),
      issueElectronicInvoice(saleB.id, actor.id),
    ]);

    expect(resultA.status).toBe("ISSUED");
    expect(resultB.status).toBe("ISSUED");
    expect(resultA.documentNumber).not.toBe(resultB.documentNumber);
    expect([resultA.documentNumber, resultB.documentNumber].sort()).toEqual(["1", "2"]);
  });

  it("a network failure during CAE request leaves the document PENDING with an uncertain-outcome marker, and throws", async () => {
    const actor = await makeActor();
    await configureIssuerProfile(actor.id, 900_005);
    const sale = await makeConfirmedSale(actor.id);
    const intent = await createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id);
    fakeInvoiceProvider.forceNextRequestNetworkErrorForTesting();

    await expect(issueElectronicInvoice(sale.id, actor.id)).rejects.toThrow(ArcaIssuanceUncertainError);

    const stillPending = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: intent.id } });
    expect(stillPending.status).toBe("PENDING");
    const metadata = stillPending.arcaResponseMetadata as { status: string; attemptedVoucherNumber: number };
    expect(metadata.status).toBe("UNCERTAIN");
    expect(metadata.attemptedVoucherNumber).toBe(1);
  });

  it("reconcileArcaFiscalDocument resolves an uncertain outcome to ISSUED when ARCA actually authorized the voucher", async () => {
    const actor = await makeActor();
    const pointOfSale = 900_006;
    await configureIssuerProfile(actor.id, pointOfSale);
    const sale = await makeConfirmedSale(actor.id, 121000n);
    const intent = await createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id);
    fakeInvoiceProvider.forceNextRequestNetworkErrorForTesting();
    await expect(issueElectronicInvoice(sale.id, actor.id)).rejects.toThrow(ArcaIssuanceUncertainError);

    // Simulates "ARCA actually processed it despite our network failure".
    fakeInvoiceProvider.issueVoucherDirectlyForTesting(
      pointOfSale,
      ARCA_CBTE_TIPO_CODE.FACTURA_B,
      1,
      "FAKECAE-RECONCILED",
      1210.0,
    );

    const reconciled = await reconcileArcaFiscalDocument(intent.id, actor.id);

    expect(reconciled.status).toBe("ISSUED");
    expect(reconciled.cae).toBe("FAKECAE-RECONCILED");
    expect(reconciled.documentNumber).toBe("1");
  });

  it("reconcileArcaFiscalDocument leaves the document retryable when ARCA never actually authorized the attempted voucher", async () => {
    const actor = await makeActor();
    await configureIssuerProfile(actor.id, 900_007);
    const sale = await makeConfirmedSale(actor.id);
    const intent = await createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id);
    fakeInvoiceProvider.forceNextRequestNetworkErrorForTesting();
    await expect(issueElectronicInvoice(sale.id, actor.id)).rejects.toThrow(ArcaIssuanceUncertainError);

    const reconciled = await reconcileArcaFiscalDocument(intent.id, actor.id);
    expect(reconciled.status).toBe("PENDING");

    // Safe to retry a fresh issuance afterward — gets a clean voucher 1
    // (the failed attempt was never actually authorized).
    const issued = await issueElectronicInvoice(sale.id, actor.id);
    expect(issued.status).toBe("ISSUED");
    expect(issued.documentNumber).toBe("1");
  });

  it("reconciling an already-ISSUED document is a safe no-op", async () => {
    const actor = await makeActor();
    await configureIssuerProfile(actor.id, 900_008);
    const sale = await makeConfirmedSale(actor.id);
    await createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id);
    const issued = await issueElectronicInvoice(sale.id, actor.id);

    const reconciled = await reconcileArcaFiscalDocument(issued.id, actor.id);

    expect(reconciled.id).toBe(issued.id);
    expect(reconciled.cae).toBe(issued.cae);
  });

  it("reconcileArcaFiscalDocument throws for a document with nothing uncertain to reconcile", async () => {
    const actor = await makeActor();
    await configureIssuerProfile(actor.id, 900_009);
    const sale = await makeConfirmedSale(actor.id);
    const intent = await createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id);

    await expect(reconcileArcaFiscalDocument(intent.id, actor.id)).rejects.toThrow(FiscalDocumentNotReconcilableError);
  });

  it("refuses with ArcaIssuanceNotReadyError when connection readiness is not overridden to ready", async () => {
    setArcaConnectionReadinessForTesting(null);
    const actor = await makeActor();
    await configureIssuerProfile(actor.id, 900_010);
    const sale = await makeConfirmedSale(actor.id);
    await createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id);

    // Real check runs — this test environment has no certificate on disk.
    await expect(issueElectronicInvoice(sale.id, actor.id)).rejects.toThrow(ArcaIssuanceNotReadyError);
  });

  it("MANUAL fiscal documents are completely unaffected by the real ARCA flow", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 50000n);
    const manual = await registerManualFiscalDocument(
      {
        saleId: sale.id,
        documentType: "Factura B",
        pointOfSale: "0001",
        documentNumber: `${Date.now()}`,
        issueDate: new Date(),
        totalAmount: 50000n,
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );

    // No ELECTRONICA_ARCA intent exists for this Sale — the real flow must
    // refuse rather than somehow acting on the MANUAL document.
    await expect(issueElectronicInvoice(sale.id, actor.id)).rejects.toThrow();

    const untouched = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: manual.id } });
    expect(untouched.status).toBe("ISSUED");
    expect(untouched.mode).toBe("MANUAL");
    expect(untouched.cae).toBeNull();
  });

  it("preserves the existing cancellation-block rule for a Sale with a real ISSUED ELECTRONICA_ARCA document", async () => {
    const actor = await makeActor();
    await configureIssuerProfile(actor.id, 900_011);
    const sale = await makeConfirmedSale(actor.id);
    await createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id);
    await issueElectronicInvoice(sale.id, actor.id);

    await expect(cancelSale(sale.id, "intento de cancelación", actor.id)).rejects.toThrow(SaleHasFiscalDocumentError);
  });
});
