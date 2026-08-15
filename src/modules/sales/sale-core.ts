import type { Prisma, Sale, SaleStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db-core";
import { recordAuditLog } from "@/modules/audit/index-core";
import { getCustomerDisplayName } from "@/modules/customers/normalize";
import {
  applyInventoryOperation,
  DuplicateOperationError,
  InactiveWarehouseError,
  InsufficientStockError,
} from "@/modules/inventory/service-core";
import { getEffectivePrice } from "@/modules/products/pricing";

import { buildCandidateSaleCode } from "./record-code";
import { computeSaleItemTotals, computeSaleTotals } from "./totals";

export { InvalidSaleItemError } from "./totals";
// Re-exported so callers (Server Actions, tests) can recognize a stock
// error surfacing from inside the sale-confirmation path without importing
// the inventory module directly — the sales module is the boundary a Sale
// caller talks to, never modules/inventory/* directly.
export { InactiveWarehouseError } from "@/modules/inventory/service-core";

// Node-safe core: no "server-only" import, and imports db-core.ts/
// audit/index-core.ts (not the "server-only"-guarded wrappers) so this stays
// importable from a plain Node context (Playwright's test-runner process,
// prisma/seed.ts via tsx) — mirrors modules/customers/customer-core.ts's
// exact -core/wrapper split.
//
// SCOPE — internal/manual sales foundation, now integrated with real
// inventory (see the Sales -> Inventory integration checkpoint). Explicitly
// still NOT this phase:
//   - ARCA invoice generation
//   - Mercado Pago payment registration
//   - online order -> Sale conversion
//   - delivery/shipping
//   - returns/refunds beyond a full-sale cancellation

export class SaleNotFoundError extends Error {
  constructor() {
    super("Venta no encontrada.");
    this.name = "SaleNotFoundError";
  }
}

export class SaleNotEditableError extends Error {
  constructor() {
    super("Esta venta ya no se puede editar.");
    this.name = "SaleNotEditableError";
  }
}

export class SaleAlreadyCancelledError extends Error {
  constructor() {
    super("Esta venta ya está cancelada.");
    this.name = "SaleAlreadyCancelledError";
  }
}

export class EmptySaleCannotBeConfirmedError extends Error {
  constructor() {
    super("Agregá al menos un producto antes de confirmar la venta.");
    this.name = "EmptySaleCannotBeConfirmedError";
  }
}

export class ProductVariantNotFoundError extends Error {
  constructor() {
    super("Uno de los productos seleccionados no existe.");
    this.name = "ProductVariantNotFoundError";
  }
}

export class ProductVariantMissingPriceError extends Error {
  constructor() {
    super("Uno de los productos seleccionados no tiene un precio configurado.");
    this.name = "ProductVariantMissingPriceError";
  }
}

export class WarehouseNotFoundError extends Error {
  constructor() {
    super("Depósito no encontrado.");
    this.name = "WarehouseNotFoundError";
  }
}

export class NoDefaultWarehouseError extends Error {
  constructor() {
    super("No hay un depósito predeterminado configurado. Contactá a un administrador.");
    this.name = "NoDefaultWarehouseError";
  }
}

export class CancellationReasonRequiredError extends Error {
  constructor() {
    super("El motivo de cancelación es obligatorio.");
    this.name = "CancellationReasonRequiredError";
  }
}

export interface StockShortfall {
  productVariantId: string;
  displayName: string;
  skuSnapshot: string;
  requested: number;
  available: number;
}

// Thrown when confirming a sale would require more stock than is actually
// available in its warehouse — carries every short-item's detail (never
// just the first one) so the UI can show the full picture at once, same
// "report every blocker together" posture as
// modules/products/visibility.ts's getVisibilityBlockers. An empty
// shortfalls array means this was thrown from the rare race-condition
// fallback (see confirmSaleWithinTransaction) where the detailed breakdown
// isn't available — still a real, safe rejection, just a less specific
// message.
export class InsufficientSaleStockError extends Error {
  constructor(public readonly shortfalls: StockShortfall[]) {
    const message =
      shortfalls.length > 0
        ? shortfalls
            .map(
              (s) =>
                `No hay stock suficiente para ${s.displayName}.\nDisponible: ${s.available}\nSolicitado: ${s.requested}.`,
            )
            .join("\n\n")
        : "No hay stock suficiente para completar la venta. Es posible que otra venta haya tomado el stock disponible justo antes de confirmar esta. Volvé a intentar.";
    super(message);
    this.name = "InsufficientSaleStockError";
  }
}

async function generateSaleCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = buildCandidateSaleCode();
    const collision = await tx.sale.count({ where: { code: candidate } });
    if (collision === 0) return candidate;
  }
  throw new Error("No se pudo generar un código de venta único.");
}

// PERSON prefers its document (DNI/etc); COMPANY prefers its CUIT — the
// single most relevant identifier for a fiscal-document-adjacent snapshot,
// never both crammed into one field. Falls back to whichever is present.
function buildCustomerDocumentSnapshot(customer: {
  type: string;
  documentType: string | null;
  documentNumber: string | null;
  taxId: string | null;
}): string | null {
  if (customer.type === "PERSON" && customer.documentNumber) {
    return customer.documentType
      ? `${customer.documentType}: ${customer.documentNumber}`
      : customer.documentNumber;
  }
  if (customer.taxId) return `CUIT: ${customer.taxId}`;
  if (customer.documentNumber) {
    return customer.documentType
      ? `${customer.documentType}: ${customer.documentNumber}`
      : customer.documentNumber;
  }
  return null;
}

// Resolves which Warehouse a sale is built against — an explicit id (must
// exist and be active) or, when omitted, the system default (see
// modules/warehouses/service-core.ts's setDefaultWarehouse). Never silently
// falls back to "any warehouse" — a store with no default configured yet is
// a real configuration gap, surfaced as NoDefaultWarehouseError rather than
// guessed around.
async function resolveWarehouseId(
  tx: Prisma.TransactionClient,
  explicitWarehouseId: string | undefined,
): Promise<string> {
  if (explicitWarehouseId) {
    const warehouse = await tx.warehouse.findUnique({ where: { id: explicitWarehouseId } });
    if (!warehouse) throw new WarehouseNotFoundError();
    if (!warehouse.isActive) throw new InactiveWarehouseError(explicitWarehouseId);
    return warehouse.id;
  }
  const defaultWarehouse = await tx.warehouse.findFirst({ where: { isDefault: true } });
  if (!defaultWarehouse) throw new NoDefaultWarehouseError();
  return defaultWarehouse.id;
}

export interface SaleItemInput {
  productVariantId: string;
  quantity: number;
  // null/undefined: resolve the current effective price (variant price,
  // falling back to the product's default) at the moment this line is
  // added — never re-resolved afterward. An explicit value overrides it
  // (see this phase's "edit unit price if allowed" requirement — gated by
  // the same sales.create permission every sale-building action requires;
  // see app/(admin)/admin/sales/actions.ts).
  unitPriceAmount?: bigint | null;
  discountAmount?: bigint | null;
}

interface ResolvedSaleItem {
  productVariantId: string;
  productNameSnapshot: string;
  skuSnapshot: string;
  quantity: number;
  unitPriceAmount: bigint;
  discountAmount: bigint;
  subtotalAmount: bigint;
  totalAmount: bigint;
}

async function resolveSaleItem(
  tx: Prisma.TransactionClient,
  input: SaleItemInput,
): Promise<ResolvedSaleItem> {
  const variant = await tx.productVariant.findUnique({
    where: { id: input.productVariantId },
    include: { product: { select: { name: true, defaultPriceAmount: true } } },
  });
  if (!variant) throw new ProductVariantNotFoundError();

  const unitPriceAmount =
    input.unitPriceAmount ??
    getEffectivePrice({
      variantPriceAmount: variant.priceAmount,
      productDefaultPriceAmount: variant.product.defaultPriceAmount,
    });
  if (unitPriceAmount === null) throw new ProductVariantMissingPriceError();

  const discountAmount = input.discountAmount ?? 0n;
  const { subtotalAmount, totalAmount } = computeSaleItemTotals({
    quantity: input.quantity,
    unitPriceAmount,
    discountAmount,
  });

  return {
    productVariantId: variant.id,
    productNameSnapshot: variant.name ? `${variant.product.name} - ${variant.name}` : variant.product.name,
    skuSnapshot: variant.sku,
    quantity: input.quantity,
    unitPriceAmount,
    discountAmount,
    subtotalAmount,
    totalAmount,
  };
}

// Aggregates requested quantity PER VARIANT across every line first (a sale
// may legitimately list the same variant on two separate lines) and
// compares that sum against the warehouse's real current balance ONCE per
// variant — never checked line-by-line, which could under- or over-count
// against a shared pool. Read-only: this is the friendly-error path, not
// the actual safety mechanism (see confirmSaleWithinTransaction — the real
// guarantee is applyInventoryOperation's own atomic guarded UPDATE, which
// re-checks the authoritative balance regardless of what this found a
// moment earlier).
async function findStockShortfalls(
  tx: Prisma.TransactionClient,
  warehouseId: string,
  items: Array<{ productVariantId: string; quantity: number; productNameSnapshot: string; skuSnapshot: string }>,
): Promise<StockShortfall[]> {
  const requestedByVariant = new Map<
    string,
    { quantity: number; displayName: string; skuSnapshot: string }
  >();
  for (const item of items) {
    const existing = requestedByVariant.get(item.productVariantId);
    requestedByVariant.set(item.productVariantId, {
      quantity: (existing?.quantity ?? 0) + item.quantity,
      displayName: existing?.displayName ?? item.productNameSnapshot,
      skuSnapshot: existing?.skuSnapshot ?? item.skuSnapshot,
    });
  }

  const variantIds = [...requestedByVariant.keys()];
  const balances = await tx.inventoryBalance.findMany({
    where: { warehouseId, variantId: { in: variantIds } },
  });
  const availableByVariant = new Map(balances.map((b) => [b.variantId, b.quantity]));

  const shortfalls: StockShortfall[] = [];
  for (const [variantId, { quantity, displayName, skuSnapshot }] of requestedByVariant) {
    const available = availableByVariant.get(variantId) ?? 0;
    if (quantity > available) {
      shortfalls.push({ productVariantId: variantId, displayName, skuSnapshot, requested: quantity, available });
    }
  }
  return shortfalls;
}

// The one place a DRAFT sale actually becomes CONFIRMED and consumes real
// inventory — called from confirmSale, and from createSale/updateSale when
// their own `confirm: true` option is set, so there is exactly one
// deduction code path regardless of how confirmation was reached. Assumes
// the caller has already established the sale is in a confirmable state
// (DRAFT, existing) — every current caller does (assertEditableDraft, or a
// same-transaction fresh INSERT).
//
// Atomicity: this whole function runs inside the caller's transaction.
// findStockShortfalls is a pre-check for a friendly, itemized error message
// in the common case; the actual all-or-nothing guarantee is
// applyInventoryOperation's own sequential, per-movement guarded UPDATE
// (`WHERE quantity + delta >= 0`) — if ANY movement can't be satisfied, it
// throws and the entire transaction (every movement already applied in
// this same call, plus the Sale/SaleItem writes around it) rolls back
// together. Never a partial deduction.
//
// Concurrency: idempotencyKey `sale-confirm:${id}` is a real, unique DB
// column (InventoryOperation.idempotencyKey) — two concurrent attempts to
// confirm the SAME sale (a genuine race: both could read status === DRAFT
// before either commits, under Postgres's default READ COMMITTED
// isolation) can only successfully INSERT one InventoryOperation row with
// that key; the loser gets DuplicateOperationError, translated below into
// SaleNotEditableError rather than a confusing inventory-internals message.
// Two DIFFERENT sales competing for the same variant's last unit are
// protected by applyInventoryOperation's guarded UPDATE itself — Postgres's
// row lock on inventory_balance serializes the two UPDATEs, and the second
// one's own WHERE clause sees the first's already-applied deduction and
// correctly finds insufficient stock.
async function confirmSaleWithinTransaction(
  tx: Prisma.TransactionClient,
  id: string,
  actorId: string,
): Promise<Sale> {
  const sale = await tx.sale.findUniqueOrThrow({ where: { id } });
  const items = await tx.saleItem.findMany({ where: { saleId: id } });
  if (items.length === 0) throw new EmptySaleCannotBeConfirmedError();

  const shortfalls = await findStockShortfalls(tx, sale.warehouseId, items);
  if (shortfalls.length > 0) throw new InsufficientSaleStockError(shortfalls);

  try {
    await applyInventoryOperation(
      tx,
      {
        operationType: "SALE",
        idempotencyKey: `sale-confirm:${id}`,
        actorId,
        reason: `Venta ${sale.code}`,
      },
      items.map((item) => ({
        variantId: item.productVariantId,
        warehouseId: sale.warehouseId,
        movementType: "SALE" as const,
        quantityDelta: -item.quantity,
        relatedEntityType: "Sale",
        relatedEntityId: id,
      })),
    );
  } catch (error) {
    if (error instanceof DuplicateOperationError) throw new SaleNotEditableError();
    if (error instanceof InsufficientStockError) throw new InsufficientSaleStockError([]);
    throw error;
  }

  return tx.sale.update({ where: { id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
}

export interface CreateSaleInput {
  customerId: string;
  // Omitted: resolves to the system default warehouse — see
  // resolveWarehouseId. Explicit: must be an active Warehouse.
  warehouseId?: string;
  items: SaleItemInput[];
  notes?: string | null;
  // Create directly as CONFIRMED instead of DRAFT — see confirmSale for the
  // same >=1-item rule, enforced here too so a bad request never even
  // creates a phantom draft.
  confirm?: boolean;
}

export async function createSale(input: CreateSaleInput, actorId: string): Promise<Sale> {
  if (input.confirm && input.items.length === 0) {
    throw new EmptySaleCannotBeConfirmedError();
  }

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new Error("Cliente no encontrado.");

    const warehouseId = await resolveWarehouseId(tx, input.warehouseId);

    const resolvedItems = await Promise.all(input.items.map((item) => resolveSaleItem(tx, item)));
    const totals = computeSaleTotals(resolvedItems);

    // Always created as DRAFT first — confirmSaleWithinTransaction (below,
    // when input.confirm) is what actually deducts stock and flips status,
    // so there is exactly one code path for "a sale becomes CONFIRMED",
    // never a second copy of the stock-deduction logic here.
    let sale = await tx.sale.create({
      data: {
        code: await generateSaleCode(tx),
        customerId: customer.id,
        warehouseId,
        createdById: actorId,
        status: "DRAFT",
        customerNameSnapshot: getCustomerDisplayName(customer),
        customerDocumentSnapshot: buildCustomerDocumentSnapshot(customer),
        subtotalAmount: totals.subtotalAmount,
        discountTotalAmount: totals.discountTotalAmount,
        taxTotalAmount: 0n,
        totalAmount: totals.totalAmount,
        notes: input.notes || null,
        items: { create: resolvedItems },
      },
    });

    await recordAuditLog(
      {
        userId: actorId,
        action: "sale.created_draft",
        entityType: "Sale",
        entityId: sale.id,
        newValue: { code: sale.code, totalAmount: sale.totalAmount.toString(), itemCount: resolvedItems.length },
      },
      tx,
    );

    if (input.confirm) {
      sale = await confirmSaleWithinTransaction(tx, sale.id, actorId);
      await recordAuditLog(
        { userId: actorId, action: "sale.confirmed", entityType: "Sale", entityId: sale.id },
        tx,
      );
    }

    return sale;
  });
}

async function assertEditableDraft(tx: Prisma.TransactionClient, id: string): Promise<Sale> {
  const sale = await tx.sale.findUnique({ where: { id } });
  if (!sale) throw new SaleNotFoundError();
  if (sale.status !== "DRAFT") throw new SaleNotEditableError();
  return sale;
}

export interface UpdateSaleInput {
  warehouseId?: string;
  items: SaleItemInput[];
  notes?: string | null;
  confirm?: boolean;
}

// Replaces the entire item set (delete + recreate inside the same
// transaction) rather than diffing — simplest correct approach for a
// foundation phase, and cheap given a sale realistically has a handful of
// lines. Only ever allowed while status === DRAFT; a CONFIRMED or
// CANCELLED sale must go through cancelSale instead, never this — which is
// also what makes Sale.warehouseId immutable once confirmed: there is no
// code path that can reach this function for a non-DRAFT sale at all.
export async function updateSale(id: string, input: UpdateSaleInput, actorId: string): Promise<Sale> {
  if (input.confirm && input.items.length === 0) {
    throw new EmptySaleCannotBeConfirmedError();
  }

  return prisma.$transaction(async (tx) => {
    const existing = await assertEditableDraft(tx, id);
    const warehouseId = input.warehouseId
      ? await resolveWarehouseId(tx, input.warehouseId)
      : existing.warehouseId;

    const resolvedItems = await Promise.all(input.items.map((item) => resolveSaleItem(tx, item)));
    const totals = computeSaleTotals(resolvedItems);

    await tx.saleItem.deleteMany({ where: { saleId: id } });

    let sale = await tx.sale.update({
      where: { id },
      data: {
        warehouseId,
        subtotalAmount: totals.subtotalAmount,
        discountTotalAmount: totals.discountTotalAmount,
        taxTotalAmount: 0n,
        totalAmount: totals.totalAmount,
        notes: input.notes !== undefined ? input.notes || null : existing.notes,
        items: { create: resolvedItems },
      },
    });

    await recordAuditLog(
      {
        userId: actorId,
        action: "sale.updated_draft",
        entityType: "Sale",
        entityId: sale.id,
        newValue: { totalAmount: sale.totalAmount.toString(), itemCount: resolvedItems.length },
      },
      tx,
    );

    if (input.confirm) {
      sale = await confirmSaleWithinTransaction(tx, id, actorId);
      await recordAuditLog(
        { userId: actorId, action: "sale.confirmed", entityType: "Sale", entityId: id },
        tx,
      );
    }

    return sale;
  });
}

// Explicit, standalone confirm — for a UI action that confirms a draft
// as-is without touching its items. See updateSale's `confirm` option for
// the "edit and confirm in one step" case. See
// confirmSaleWithinTransaction's own doc comment for the full atomicity/
// concurrency contract.
export async function confirmSale(id: string, actorId: string): Promise<Sale> {
  return prisma.$transaction(async (tx) => {
    await assertEditableDraft(tx, id);
    const sale = await confirmSaleWithinTransaction(tx, id, actorId);
    await recordAuditLog(
      { userId: actorId, action: "sale.confirmed", entityType: "Sale", entityId: id },
      tx,
    );
    return sale;
  });
}

// DRAFT or CONFIRMED -> CANCELLED. Never deletes — see this phase's
// explicit "prefer cancellation over deletion" rule; there is no delete
// function anywhere in this module. `reason` is mandatory (non-empty after
// trimming) regardless of the sale's current status — every cancellation
// gets a real, recorded reason, not just the stock-reversing ones.
//
// A DRAFT sale never reserved stock, so cancelling one is a pure status
// change — no inventory movement at all (see this phase's explicit "draft
// cancellation" distinction). A CONFIRMED sale's cancellation creates real
// SALE_CANCELLATION reversal movements restoring the exact quantities to
// the SAME warehouse the original SALE movements deducted from — the
// original SALE movements themselves are never edited or deleted
// (InventoryMovement is append-only at the DB level regardless).
//
// Idempotent: a second cancel attempt on an already-CANCELLED sale is
// rejected outright by the status check below before any inventory call —
// and, for the same race-condition reason documented on
// confirmSaleWithinTransaction, the reversal operation itself also carries
// idempotencyKey `sale-cancel:${id}`, so two concurrent cancel attempts on
// the same CONFIRMED sale can only actually restore stock once; the loser
// gets DuplicateOperationError, translated to SaleAlreadyCancelledError.
export async function cancelSale(id: string, reason: string, actorId: string): Promise<Sale> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new CancellationReasonRequiredError();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.sale.findUnique({ where: { id } });
    if (!existing) throw new SaleNotFoundError();
    if (existing.status === "CANCELLED") throw new SaleAlreadyCancelledError();

    if (existing.status === "CONFIRMED") {
      const items = await tx.saleItem.findMany({ where: { saleId: id } });
      try {
        await applyInventoryOperation(
          tx,
          {
            operationType: "SALE",
            idempotencyKey: `sale-cancel:${id}`,
            actorId,
            reason: `Cancelación de venta ${existing.code}`,
            notes: trimmedReason,
          },
          items.map((item) => ({
            variantId: item.productVariantId,
            warehouseId: existing.warehouseId,
            movementType: "SALE_CANCELLATION" as const,
            quantityDelta: item.quantity,
            relatedEntityType: "Sale",
            relatedEntityId: id,
          })),
        );
      } catch (error) {
        if (error instanceof DuplicateOperationError) throw new SaleAlreadyCancelledError();
        throw error;
      }
    }

    const sale = await tx.sale.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: actorId,
        cancelReason: trimmedReason,
      },
    });

    await recordAuditLog(
      {
        userId: actorId,
        action: "sale.cancelled",
        entityType: "Sale",
        entityId: id,
        previousValue: { status: existing.status },
        newValue: { status: "CANCELLED", reason: trimmedReason },
      },
      tx,
    );

    return sale;
  });
}

export async function getSaleById(id: string) {
  return prisma.sale.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, code: true, type: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
      cancelledBy: { select: { id: true, name: true } },
      items: { orderBy: { createdAt: "asc" } },
    },
  });
}

export interface ListSalesInput {
  search?: string;
  status?: SaleStatus;
  take?: number;
  skip?: number;
}

// Search covers code and the customer-name snapshot stored on the sale
// itself (never a live join back to Customer for search — the snapshot IS
// what a sale "shows" as its customer). Single query, no N+1.
export async function listSales(input: ListSalesInput = {}): Promise<{ sales: Sale[]; total: number }> {
  const take = input.take ?? 25;
  const skip = input.skip ?? 0;
  const searchTerm = input.search?.trim();

  const where: Prisma.SaleWhereInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(searchTerm
      ? {
          OR: [
            { code: { contains: searchTerm, mode: "insensitive" } },
            { customerNameSnapshot: { contains: searchTerm, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
    prisma.sale.count({ where }),
  ]);

  return { sales, total };
}

// Lightweight product-variant search for the sale-builder's "add product"
// picker — active variants only, includes what the picker/line-item editor
// needs to display, pre-fill a price, and show real available stock in the
// sale's own warehouse (never a full catalog query, never aggregated
// across every warehouse — this phase's stock figures are always scoped to
// the one warehouse a given sale is being built against). Never N+1: two
// queries total regardless of result count (variants, then their balances
// in this one warehouse), never one balance lookup per row.
export interface SellableVariant {
  id: string;
  sku: string;
  displayName: string;
  effectivePriceAmount: bigint | null;
  availableStock: number;
}

export async function searchSellableVariants(
  search: string,
  warehouseId: string,
  take = 10,
): Promise<SellableVariant[]> {
  const term = search.trim();
  if (!term) return [];

  const variants = await prisma.productVariant.findMany({
    where: {
      isActive: true,
      OR: [
        { sku: { contains: term, mode: "insensitive" } },
        { barcode: { contains: term, mode: "insensitive" } },
        { name: { contains: term, mode: "insensitive" } },
        { product: { name: { contains: term, mode: "insensitive" } } },
      ],
    },
    include: { product: { select: { name: true, defaultPriceAmount: true } } },
    take,
  });

  const balances = await prisma.inventoryBalance.findMany({
    where: { warehouseId, variantId: { in: variants.map((v) => v.id) } },
  });
  const stockByVariant = new Map(balances.map((b) => [b.variantId, b.quantity]));

  return variants.map((variant) => ({
    id: variant.id,
    sku: variant.sku,
    displayName: variant.name ? `${variant.product.name} - ${variant.name}` : variant.product.name,
    effectivePriceAmount: getEffectivePrice({
      variantPriceAmount: variant.priceAmount,
      productDefaultPriceAmount: variant.product.defaultPriceAmount,
    }),
    availableStock: stockByVariant.get(variant.id) ?? 0,
  }));
}

// Per-variant available stock in one warehouse, for a known set of
// variants — used by the draft sale screen to show "Disponible: N" next to
// each already-added line item (as opposed to searchSellableVariants,
// which is for the "add a new product" picker). One query, no N+1.
export async function getAvailableStockForVariants(
  variantIds: string[],
  warehouseId: string,
): Promise<Map<string, number>> {
  if (variantIds.length === 0) return new Map();
  const balances = await prisma.inventoryBalance.findMany({
    where: { warehouseId, variantId: { in: variantIds } },
  });
  return new Map(balances.map((b) => [b.variantId, b.quantity]));
}
