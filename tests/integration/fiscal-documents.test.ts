// @vitest-environment node
import "./guard";

import { afterEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createTestUser, deleteTestUser } from "../fixtures/users";
import { createCategory } from "@/modules/categories/service";
import { createCustomer, updateCustomer } from "@/modules/customers/customer";
import {
  ArcaIssuanceNotReadyError,
  issueElectronicInvoice,
} from "@/modules/fiscal-documents/arca/issue-electronic-invoice";
import {
  ArcaDataNotReadyError,
  createArcaInvoicingIntent,
  deriveSaleInvoicingStatus,
  DuplicateFiscalDocumentIdentifierError,
  FiscalDocumentAmountMismatchError,
  FiscalDocumentAlreadyVoidedError,
  getInvoicingStatusForSales,
  getSaleInvoicingSummary,
  listFiscalDocumentsForSale,
  registerExternalFiscalDocument,
  registerManualFiscalDocument,
  RequiredFieldMissingError,
  SaleAlreadyHasActiveFiscalDocumentError,
  SaleNotInvoiceableError,
  voidFiscalDocument,
  VoidReasonRequiredError,
} from "@/modules/fiscal-documents/fiscal-document";
import { adjustInventory } from "@/modules/inventory/service";
import { createProduct, createVariants } from "@/modules/products/service";
import { cancelSale, createSale, SaleHasFiscalDocumentError } from "@/modules/sales/sale";
import { listSales } from "@/modules/sales/sale";
import { getStoreConfiguration, updateStoreConfiguration } from "@/modules/store-settings/service";
import { getDefaultWarehouse } from "@/modules/warehouses/service";

describe("fiscal documents — Fiscal Invoicing Foundation (real DB)", () => {
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
      name: "Fiscal Actor",
      email: `fiscal-actor-${Date.now()}-${Math.random()}@test.chaioboutique.local`,
      password: "password123",
    });
    createdUserIds.push(actor.id);
    return actor;
  }

  async function makeSellableVariant(actorId: string, priceAmount: bigint) {
    const category = await createCategory({ name: `Fiscal Cat ${Date.now()}-${Math.random()}` }, actorId);
    const product = await createProduct(
      { name: `Fiscal Producto ${Date.now()}-${Math.random()}`, categoryId: category.id },
      actorId,
    );
    const [variant] = await createVariants(
      product.id,
      [{ sizeOptionId: null, colorId: null, sku: `FISCAL-SKU-${Date.now()}-${Math.random()}`, priceAmount }],
      actorId,
    );
    return variant;
  }

  async function getDefaultWarehouseId() {
    const warehouse = await getDefaultWarehouse();
    if (!warehouse) throw new Error("No default warehouse seeded — check reset-db.ts.");
    return warehouse.id;
  }

  async function makePersonCustomer(actorId: string, overrides: { email?: string } = {}) {
    const result = await createCustomer(
      {
        type: "PERSON",
        firstName: "Cliente",
        lastName: `Fiscal ${Date.now()}-${Math.random()}`,
        documentType: "DNI",
        documentNumber: `${Math.floor(10000000 + Math.random() * 89999999)}`,
        email: overrides.email,
      },
      actorId,
    );
    if (result.status !== "created") throw new Error("unreachable");
    return result.customer;
  }

  async function makeConfirmedSale(actorId: string, totalAmount = 100000n, quantity = 1, customerId?: string) {
    const customer = customerId ? { id: customerId } : await makePersonCustomer(actorId);
    const unitPrice = totalAmount / BigInt(quantity);
    const variant = await makeSellableVariant(actorId, unitPrice);
    const warehouseId = await getDefaultWarehouseId();
    await adjustInventory({
      variantId: variant.id,
      warehouseId,
      quantityDelta: quantity + 5,
      movementType: "INITIAL_STOCK",
      actorId,
    });
    const sale = await createSale(
      { customerId: customer.id, items: [{ productVariantId: variant.id, quantity }], confirm: true },
      actorId,
    );
    return sale;
  }

  // fiscal_document_identifier_unique is a GLOBAL index (scoped by
  // mode/sourceSystem/documentType/pointOfSale/documentNumber, never by
  // Sale) — every test in this file shares one database for the whole
  // `vitest run` invocation (globalSetup resets it once, not per test), so
  // a hardcoded literal like "1" would collide across unrelated tests.
  // Every test that isn't specifically exercising identifier-collision
  // behavior uses this instead.
  function uniqueDocNumber(): string {
    return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  }

  // Sets a fully DATA-READY issuer fiscal profile — used only by the tests
  // that specifically exercise createArcaInvoicingIntent's readiness gate.
  // StoreConfiguration is a single shared row across this whole test run
  // (globalSetup resets it once, not per test) — every test that mutates it
  // MUST restore it via `cleanup`, so it never leaks into an unrelated test
  // that assumes the default unconfigured state.
  async function configureCompleteIssuerProfile(actorId: string) {
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
    await updateStoreConfiguration(
      {
        fiscalLegalName: "CHAIOBOUTIQUE S.R.L.",
        fiscalTaxId: "30-71234567-9",
        issuerVatCondition: "RESPONSABLE_INSCRIPTO",
        arcaPointOfSale: 1,
        arcaEnvironment: "HOMOLOGATION",
      },
      actorId,
    );
  }

  async function makeDraftSale(actorId: string, totalAmount = 100000n) {
    const customer = await makePersonCustomer(actorId);
    const variant = await makeSellableVariant(actorId, totalAmount);
    return createSale({ customerId: customer.id, items: [{ productVariantId: variant.id, quantity: 1 }] }, actorId);
  }

  // ===========================================================================
  // Uninvoiced Sale
  // ===========================================================================
  it("a freshly confirmed sale is NOT_INVOICED with no active document", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id);

    const summary = await getSaleInvoicingSummary(sale.id);
    expect(summary.status).toBe("NOT_INVOICED");
    expect(summary.activeDocument).toBeNull();
    expect(deriveSaleInvoicingStatus(null)).toBe("NOT_INVOICED");
  });

  // ===========================================================================
  // MANUAL registration
  // ===========================================================================
  it("registers a manual fiscal document and shows the Sale as invoiced", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 150000n);
    const docNumber = uniqueDocNumber();

    const document = await registerManualFiscalDocument(
      {
        saleId: sale.id,
        documentType: "Factura B",
        pointOfSale: "0004",
        documentNumber: docNumber,
        issueDate: new Date("2026-08-18"),
        totalAmount: 150000n,
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );

    expect(document.mode).toBe("MANUAL");
    expect(document.status).toBe("ISSUED");
    expect(document.documentType).toBe("Factura B");
    expect(document.pointOfSale).toBe("0004");
    expect(document.documentNumber).toBe(docNumber);
    expect(document.totalAmount).toBe(150000n);
    expect(document.netAmount).toBe(150000n);
    expect(document.taxAmount).toBe(0n);

    const summary = await getSaleInvoicingSummary(sale.id);
    expect(summary.status).toBe("INVOICED");
    expect(summary.activeDocument?.id).toBe(document.id);
  });

  it("requires the real identifying fields for a manual document", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);

    await expect(
      registerManualFiscalDocument(
        {
          saleId: sale.id,
          documentType: "",
          pointOfSale: "0004",
          documentNumber: uniqueDocNumber(),
          issueDate: new Date(),
          totalAmount: 100000n,
          idempotencyKey: crypto.randomUUID(),
        },
        actor.id,
      ),
    ).rejects.toThrow(RequiredFieldMissingError);
  });

  // ===========================================================================
  // SISTEMA_EXTERNO registration
  // ===========================================================================
  it("registers an external fiscal document with its source system, and shows the Sale as invoiced", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 80000n);

    const document = await registerExternalFiscalDocument(
      {
        saleId: sale.id,
        documentType: "Factura C",
        documentNumber: uniqueDocNumber(),
        issueDate: new Date("2026-06-01"),
        totalAmount: 80000n,
        sourceSystem: "Sistema anterior",
        externalReference: "REF-123",
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );

    expect(document.mode).toBe("SISTEMA_EXTERNO");
    expect(document.status).toBe("ISSUED");
    expect(document.sourceSystem).toBe("Sistema anterior");
    expect(document.externalReference).toBe("REF-123");

    const summary = await getSaleInvoicingSummary(sale.id);
    expect(summary.status).toBe("INVOICED");

    // A Sale registered SISTEMA_EXTERNO is explicitly NOT "unbilled" — see
    // this phase's own migration-safety requirement. Confirmed by the
    // status itself being INVOICED, never NOT_INVOICED, for a Sale
    // documented this way.
    expect(summary.status).not.toBe("NOT_INVOICED");
  });

  // ===========================================================================
  // ARCA mode — non-network stub only
  // ===========================================================================
  it("createArcaInvoicingIntent refuses to create an intent while the issuer's fiscal data is incomplete", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 50000n);

    // The default, unconfigured StoreConfiguration this test run starts
    // with — no fiscalLegalName/fiscalTaxId/issuerVatCondition/
    // arcaPointOfSale/arcaEnvironment set. See section 24's explicit "DATA
    // READY" gate.
    await expect(
      createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id),
    ).rejects.toThrow(ArcaDataNotReadyError);

    expect(await prisma.fiscalDocument.count({ where: { saleId: sale.id } })).toBe(0);
  });

  it("ELECTRONICA_ARCA only ever creates a PENDING intent — never a CAE, invoice number, or ISSUED status", async () => {
    const actor = await makeActor();
    await configureCompleteIssuerProfile(actor.id);
    const sale = await makeConfirmedSale(actor.id, 50000n);

    const document = await createArcaInvoicingIntent(
      { saleId: sale.id, idempotencyKey: crypto.randomUUID() },
      actor.id,
    );

    expect(document.mode).toBe("ELECTRONICA_ARCA");
    expect(document.status).toBe("PENDING");
    expect(document.cae).toBeNull();
    expect(document.caeExpiresAt).toBeNull();
    expect(document.documentNumber).toBeNull();

    const summary = await getSaleInvoicingSummary(sale.id);
    expect(summary.status).toBe("PENDING");
  });

  // This test environment has no ARCA_CERTIFICATE_PATH/ARCA_PRIVATE_KEY_PATH
  // configured (see .env.example) — connection readiness is genuinely not
  // met, so the real issuance flow must refuse BEFORE ever contacting WSAA/
  // WSFEv1, exactly like every other unready precondition. The full,
  // real WSAA+WSFEv1 flow (using Fake providers) is covered separately in
  // tests/integration/arca-electronic-invoice.test.ts.
  it("issueElectronicInvoice refuses when connection readiness (certificate) isn't met — never contacts any network", async () => {
    const actor = await makeActor();
    await configureCompleteIssuerProfile(actor.id);
    const sale = await makeConfirmedSale(actor.id, 50000n);
    await createArcaInvoicingIntent({ saleId: sale.id, idempotencyKey: crypto.randomUUID() }, actor.id);

    await expect(issueElectronicInvoice(sale.id, actor.id)).rejects.toThrow(ArcaIssuanceNotReadyError);

    // Still PENDING — refused before any state change.
    const summary = await getSaleInvoicingSummary(sale.id);
    expect(summary.status).toBe("PENDING");
  });

  // ===========================================================================
  // Duplicate protection
  // ===========================================================================
  it("refuses to register a second active fiscal document for an already-invoiced Sale", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);

    await registerManualFiscalDocument(
      {
        saleId: sale.id,
        documentType: "Factura B",
        pointOfSale: "0001",
        documentNumber: uniqueDocNumber(),
        issueDate: new Date(),
        totalAmount: 100000n,
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );

    await expect(
      registerManualFiscalDocument(
        {
          saleId: sale.id,
          documentType: "Factura B",
          pointOfSale: "0001",
          documentNumber: uniqueDocNumber(),
          issueDate: new Date(),
          totalAmount: 100000n,
          idempotencyKey: crypto.randomUUID(),
        },
        actor.id,
      ),
    ).rejects.toThrow(SaleAlreadyHasActiveFiscalDocumentError);
  });

  it("refuses to register the same real document identifier twice, even for two different Sales", async () => {
    const actor = await makeActor();
    const saleA = await makeConfirmedSale(actor.id, 100000n);
    const saleB = await makeConfirmedSale(actor.id, 200000n);
    const sharedDocNumber = uniqueDocNumber();

    await registerManualFiscalDocument(
      {
        saleId: saleA.id,
        documentType: "Factura B",
        pointOfSale: "0004",
        documentNumber: sharedDocNumber,
        issueDate: new Date(),
        totalAmount: 100000n,
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );

    await expect(
      registerManualFiscalDocument(
        {
          saleId: saleB.id,
          documentType: "Factura B",
          pointOfSale: "0004",
          documentNumber: sharedDocNumber,
          issueDate: new Date(),
          totalAmount: 200000n,
          idempotencyKey: crypto.randomUUID(),
        },
        actor.id,
      ),
    ).rejects.toThrow(DuplicateFiscalDocumentIdentifierError);
  });

  it("two different external systems may independently reuse the same document number without colliding", async () => {
    const actor = await makeActor();
    const saleA = await makeConfirmedSale(actor.id, 100000n);
    const saleB = await makeConfirmedSale(actor.id, 200000n);
    const sharedDocNumber = uniqueDocNumber();

    const docA = await registerExternalFiscalDocument(
      {
        saleId: saleA.id,
        documentType: "Factura B",
        documentNumber: sharedDocNumber,
        issueDate: new Date(),
        totalAmount: 100000n,
        sourceSystem: "Sistema A",
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );
    const docB = await registerExternalFiscalDocument(
      {
        saleId: saleB.id,
        documentType: "Factura B",
        documentNumber: sharedDocNumber,
        issueDate: new Date(),
        totalAmount: 200000n,
        sourceSystem: "Sistema B",
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );

    expect(docA.documentNumber).toBe(docB.documentNumber);
    expect(docA.sourceSystem).not.toBe(docB.sourceSystem);
  });

  // ===========================================================================
  // Idempotent submission
  // ===========================================================================
  it("a literal retry with the SAME idempotencyKey returns the exact same document, never a duplicate", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    const key = crypto.randomUUID();
    const docNumber = uniqueDocNumber();

    const first = await registerManualFiscalDocument(
      {
        saleId: sale.id,
        documentType: "Factura B",
        pointOfSale: "0001",
        documentNumber: docNumber,
        issueDate: new Date(),
        totalAmount: 100000n,
        idempotencyKey: key,
      },
      actor.id,
    );
    const second = await registerManualFiscalDocument(
      {
        saleId: sale.id,
        documentType: "Factura B",
        pointOfSale: "0001",
        documentNumber: docNumber,
        issueDate: new Date(),
        totalAmount: 100000n,
        idempotencyKey: key,
      },
      actor.id,
    );

    expect(second.id).toBe(first.id);
    const count = await prisma.fiscalDocument.count({ where: { saleId: sale.id } });
    expect(count).toBe(1);
  });

  // A double-click/network retry with a DIFFERENT idempotencyKey (rather
  // than the literal same-key retry above) for the SAME Sale is already
  // covered by "refuses to register a second active fiscal document for an
  // already-invoiced Sale" above — the active-document pre-check rejects it
  // before the identifier-uniqueness constraint is even reached, since both
  // attempts target the same Sale. Not duplicated here.

  // ===========================================================================
  // Amount mismatch
  // ===========================================================================
  it("rejects a manual document whose entered total differs from the Sale's authoritative total", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);

    await expect(
      registerManualFiscalDocument(
        {
          saleId: sale.id,
          documentType: "Factura B",
          pointOfSale: "0001",
          documentNumber: uniqueDocNumber(),
          issueDate: new Date(),
          totalAmount: 999999n,
          idempotencyKey: crypto.randomUUID(),
        },
        actor.id,
      ),
    ).rejects.toThrow(FiscalDocumentAmountMismatchError);

    // Never silently accepted — zero documents created.
    expect(await prisma.fiscalDocument.count({ where: { saleId: sale.id } })).toBe(0);
  });

  it("rejects an external document whose entered total differs from the Sale's authoritative total", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);

    await expect(
      registerExternalFiscalDocument(
        {
          saleId: sale.id,
          documentType: "Factura B",
          documentNumber: uniqueDocNumber(),
          issueDate: new Date(),
          totalAmount: 1n,
          sourceSystem: "Sistema anterior",
          idempotencyKey: crypto.randomUUID(),
        },
        actor.id,
      ),
    ).rejects.toThrow(FiscalDocumentAmountMismatchError);
  });

  // ===========================================================================
  // Cancelled/draft Sale rejection
  // ===========================================================================
  it("refuses to invoice a CANCELLED Sale", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    await cancelSale(sale.id, "prueba", actor.id);

    await expect(
      registerManualFiscalDocument(
        {
          saleId: sale.id,
          documentType: "Factura B",
          pointOfSale: "0001",
          documentNumber: uniqueDocNumber(),
          issueDate: new Date(),
          totalAmount: 100000n,
          idempotencyKey: crypto.randomUUID(),
        },
        actor.id,
      ),
    ).rejects.toThrow(SaleNotInvoiceableError);
  });

  it("refuses to invoice a DRAFT Sale", async () => {
    const actor = await makeActor();
    const draft = await makeDraftSale(actor.id, 100000n);

    await expect(
      registerManualFiscalDocument(
        {
          saleId: draft.id,
          documentType: "Factura B",
          pointOfSale: "0001",
          documentNumber: uniqueDocNumber(),
          issueDate: new Date(),
          totalAmount: 100000n,
          idempotencyKey: crypto.randomUUID(),
        },
        actor.id,
      ),
    ).rejects.toThrow(SaleNotInvoiceableError);
  });

  // ===========================================================================
  // Invoiced Sale cancellation block
  // ===========================================================================
  it("blocks cancelling a Sale that has an active fiscal document, and allows it again once that document is voided", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    const document = await registerManualFiscalDocument(
      {
        saleId: sale.id,
        documentType: "Factura B",
        pointOfSale: "0001",
        documentNumber: uniqueDocNumber(),
        issueDate: new Date(),
        totalAmount: 100000n,
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );

    await expect(cancelSale(sale.id, "prueba", actor.id)).rejects.toThrow(SaleHasFiscalDocumentError);

    await voidFiscalDocument(document.id, "error de carga", actor.id);

    // No longer blocked — the active-document slot is free again.
    const cancelled = await cancelSale(sale.id, "prueba", actor.id);
    expect(cancelled.status).toBe("CANCELLED");
  });

  // ===========================================================================
  // Payment/fiscal independence
  // ===========================================================================
  it("a Sale may be invoiced while still UNPAID — payment and invoicing states are independent", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    expect(sale.paymentStatus).toBe("UNPAID");

    const document = await registerManualFiscalDocument(
      {
        saleId: sale.id,
        documentType: "Factura B",
        pointOfSale: "0001",
        documentNumber: uniqueDocNumber(),
        issueDate: new Date(),
        totalAmount: 100000n,
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );
    expect(document.status).toBe("ISSUED");

    const refreshedSale = await prisma.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(refreshedSale.paymentStatus).toBe("UNPAID"); // never silently flipped to PAID
  });

  // ===========================================================================
  // Fiscal snapshot persistence
  // ===========================================================================
  it("snapshots the customer's fiscal fields at registration time, and a later Customer edit never alters the historical document", async () => {
    const actor = await makeActor();
    const customer = await makePersonCustomer(actor.id);
    const originalDocumentNumber = customer.documentNumber;
    const sale = await makeConfirmedSale(actor.id, 100000n, 1, customer.id);

    const document = await registerManualFiscalDocument(
      {
        saleId: sale.id,
        documentType: "Factura B",
        pointOfSale: "0001",
        documentNumber: uniqueDocNumber(),
        issueDate: new Date(),
        totalAmount: 100000n,
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );
    expect(document.customerDocumentNumberSnapshot).toBe(originalDocumentNumber);
    expect(document.customerNameSnapshot).toContain("Cliente");

    await updateCustomer(customer.id, { documentNumber: "99999999" }, actor.id, { confirmed: true });

    const refreshedDocument = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: document.id } });
    expect(refreshedDocument.customerDocumentNumberSnapshot).toBe(originalDocumentNumber);
    expect(refreshedDocument.customerDocumentNumberSnapshot).not.toBe("99999999");
  });

  // ===========================================================================
  // Sales list invoicing filter
  // ===========================================================================
  it("listSales filters by invoicing status via a single relational query, matching getInvoicingStatusForSales", async () => {
    const actor = await makeActor();
    const invoicedSale = await makeConfirmedSale(actor.id, 111100n);
    const uninvoicedSale = await makeConfirmedSale(actor.id, 222200n);

    await registerManualFiscalDocument(
      {
        saleId: invoicedSale.id,
        documentType: "Factura B",
        pointOfSale: "0001",
        documentNumber: `list-${Date.now()}`,
        issueDate: new Date(),
        totalAmount: 111100n,
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );

    const { sales: invoicedResults } = await listSales({ invoicingStatus: "INVOICED", search: invoicedSale.code });
    expect(invoicedResults.map((s) => s.id)).toContain(invoicedSale.id);

    const { sales: notInvoicedResults } = await listSales({
      invoicingStatus: "NOT_INVOICED",
      search: uninvoicedSale.code,
    });
    expect(notInvoicedResults.map((s) => s.id)).toContain(uninvoicedSale.id);

    const statusMap = await getInvoicingStatusForSales([invoicedSale.id, uninvoicedSale.id]);
    expect(statusMap.get(invoicedSale.id)).toBe("INVOICED");
    expect(statusMap.get(uninvoicedSale.id)).toBeUndefined(); // absent = NOT_INVOICED
  });

  // ===========================================================================
  // Finalized document immutability / correction workflow
  // ===========================================================================
  it("voiding a fiscal document requires a reason, never edits the original fields, and preserves it in history", async () => {
    const actor = await makeActor();
    const sale = await makeConfirmedSale(actor.id, 100000n);
    const originalDocNumber = uniqueDocNumber();
    const document = await registerManualFiscalDocument(
      {
        saleId: sale.id,
        documentType: "Factura B",
        pointOfSale: "0001",
        documentNumber: originalDocNumber,
        issueDate: new Date(),
        totalAmount: 100000n,
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );

    await expect(voidFiscalDocument(document.id, "", actor.id)).rejects.toThrow(VoidReasonRequiredError);

    const voided = await voidFiscalDocument(document.id, "número mal cargado", actor.id);
    expect(voided.status).toBe("VOIDED");
    expect(voided.voidReason).toBe("número mal cargado");
    // Original identification untouched — a status flag + audit trail,
    // never a rewrite.
    expect(voided.documentType).toBe("Factura B");
    expect(voided.documentNumber).toBe(originalDocNumber);
    expect(voided.totalAmount).toBe(100000n);

    await expect(voidFiscalDocument(document.id, "otra vez", actor.id)).rejects.toThrow(
      FiscalDocumentAlreadyVoidedError,
    );

    const history = await listFiscalDocumentsForSale(sale.id);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("VOIDED");

    // A NEW document can now be registered — the "at most one active"
    // guard only ever counted the VOIDED one out.
    const replacement = await registerManualFiscalDocument(
      {
        saleId: sale.id,
        documentType: "Factura B",
        pointOfSale: "0001",
        documentNumber: uniqueDocNumber(),
        issueDate: new Date(),
        totalAmount: 100000n,
        idempotencyKey: crypto.randomUUID(),
      },
      actor.id,
    );
    expect(replacement.id).not.toBe(document.id);

    const finalHistory = await listFiscalDocumentsForSale(sale.id);
    expect(finalHistory).toHaveLength(2);
  });
});
