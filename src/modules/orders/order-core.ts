import type {
  DeliveryMethod,
  FiscalTaxCategory,
  Order,
  OrderStatus,
  OrderPaymentStatus,
  Prisma,
  Sale,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db-core";
import { env } from "@/lib/env-core";
import { recordAuditLog } from "@/modules/audit/index-core";
import { findPossibleDuplicateCustomers, createCustomer } from "@/modules/customers/customer-core";
import { resolveSaleItemTaxSnapshot } from "@/modules/fiscal-documents/arca/fiscal-tax-category-core";
import { getAvailableToSellForVariants } from "@/modules/inventory/service-core";
import {
  releaseAllActiveReservationsForOrder,
  releaseReservation,
  reserveStock,
} from "@/modules/inventory/reservation-core";
import { getEffectivePrice } from "@/modules/products/pricing";
import { isPubliclyVisible } from "@/modules/products/visibility";
import { getSystemAccountUserId } from "@/modules/roles/seed-core";
import {
  confirmSaleWithinTransaction,
  generateSaleCode,
  InsufficientSaleStockError,
} from "@/modules/sales/sale-core";
import { registerSalePaymentWithinTransaction } from "@/modules/sales/payment-core";
import { computeSaleItemTotals, computeSaleTotals } from "@/modules/sales/totals";
import { getStoreConfiguration } from "@/modules/store-settings/service-core";
import { getDefaultWarehouse } from "@/modules/warehouses/service-core";

import { generateOrderAccessToken, hashOrderAccessToken } from "./access-token";
import { RESERVATION_WINDOW_MINUTES } from "./constants";
import { buildCandidateOrderCode } from "./record-code";

// Node-safe core: no "server-only" import — mirrors modules/sales/
// sale-core.ts's exact posture, so this stays importable from a plain Node
// context (Playwright's test-runner process, integration tests). Cart
// identity/cookie resolution never happens here — every function below
// takes already-resolved ids (cartId, userId, customerId) as plain input;
// see app/(public)/checkout/actions.ts for where cookies/session are
// actually resolved, exactly the same "-core does the work, the Server
// Action resolves who's asking" split registerSalePaymentAction/
// registerSalePayment already establish.
//
// SCOPE — this phase turns a submitted checkout into an Order with RESERVED
// (never physically deducted) stock. Explicitly still NOT this phase:
// Mercado Pago's actual webhook/API integration, ARCA/fiscal invoicing,
// invoice PDF/email delivery, Andreani/shipping-provider APIs, returns/
// refunds, or a general customer order-history area. See
// finalizePaidOrder's own doc comment for the documented next-phase
// boundary.

export class EmptyCartError extends Error {
  constructor() {
    super("Tu carrito está vacío.");
    this.name = "EmptyCartError";
  }
}

export class CartHasBlockingIssuesError extends Error {
  constructor() {
    super("Uno o más productos de tu carrito ya no están disponibles. Volvé al carrito para revisarlos.");
    this.name = "CartHasBlockingIssuesError";
  }
}

export interface PriceChange {
  productVariantId: string;
  displayName: string;
  previousUnitPriceAmount: bigint;
  currentUnitPriceAmount: bigint;
}

// Thrown when any cart item's price changed since it was added — see this
// phase's explicit "do not silently charge a different amount" requirement.
// createOrderFromCart ALSO corrects the underlying CartItem's
// observedUnitPriceAmount to the current price before throwing this (a real,
// committed write — see that function's own comment) so a same-cart retry
// succeeds instead of looping on the same error forever.
export class PriceChangedError extends Error {
  constructor(public readonly changes: PriceChange[]) {
    super("El precio de uno o más productos cambió desde que los agregaste al carrito.");
    this.name = "PriceChangedError";
  }
}

export interface CheckoutStockShortfall {
  productVariantId: string;
  displayName: string;
  requested: number;
  available: number;
}

// Mirrors modules/sales/sale-core.ts's InsufficientSaleStockError exact
// message-building style — one line per shortfall, every blocker reported
// together, never just the first one.
export class InsufficientCheckoutStockError extends Error {
  constructor(public readonly shortfalls: CheckoutStockShortfall[]) {
    const message = shortfalls
      .map(
        (s) =>
          `${s.displayName} ya no tiene stock suficiente.\nDisponible: ${s.available}\nEn tu carrito: ${s.requested}.`,
      )
      .join("\n\n");
    super(message || "Uno o más productos ya no tienen stock suficiente.");
    this.name = "InsufficientCheckoutStockError";
  }
}

export class NoDefaultWarehouseError extends Error {
  constructor() {
    super("No hay un depósito predeterminado configurado. Contactá a un administrador.");
    this.name = "NoDefaultWarehouseError";
  }
}

export class DeliveryMethodNotAvailableError extends Error {
  constructor() {
    super("El envío a domicilio no está disponible en este momento. Elegí retiro en el local.");
    this.name = "DeliveryMethodNotAvailableError";
  }
}

export class MissingDeliveryAddressError extends Error {
  constructor() {
    super("Ingresá una dirección de envío para continuar.");
    this.name = "MissingDeliveryAddressError";
  }
}

export class AddressNotFoundError extends Error {
  constructor() {
    super("La dirección seleccionada no existe o no te pertenece.");
    this.name = "AddressNotFoundError";
  }
}

export class InvalidContactInfoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidContactInfoError";
  }
}

export class OrderNotFoundError extends Error {
  constructor() {
    super("Pedido no encontrado.");
    this.name = "OrderNotFoundError";
  }
}

export class OrderNotCancellableError extends Error {
  constructor() {
    super("Este pedido ya no se puede cancelar.");
    this.name = "OrderNotCancellableError";
  }
}

export class CancellationReasonRequiredError extends Error {
  constructor() {
    super("El motivo de cancelación es obligatorio.");
    this.name = "CancellationReasonRequiredError";
  }
}

// =============================================================================
// Delivery methods / shipping-cost policy — see StoreConfiguration.
// homeDeliveryFlatFeeAmount's own schema comment for the full "prefer a
// proper configurable amount" rationale. HOME_DELIVERY is only ever offered
// when a real flat fee has been configured; there is no "costo a coordinar"
// UI path in this phase (never an unpriced Order the customer can submit).
// =============================================================================

export interface DeliveryMethodOption {
  method: DeliveryMethod;
  label: string;
  feeAmount: bigint;
  // Only meaningful for PICKUP — see StoreConfiguration.pickupInstructions.
  pickupInstructions: string | null;
}

export async function listAvailableDeliveryMethods(): Promise<DeliveryMethodOption[]> {
  const config = await getStoreConfiguration();
  const options: DeliveryMethodOption[] = [
    { method: "PICKUP", label: "Retiro", feeAmount: 0n, pickupInstructions: config.pickupInstructions },
  ];
  if (config.homeDeliveryFlatFeeAmount !== null) {
    options.push({
      method: "HOME_DELIVERY",
      label: "Envío a domicilio",
      feeAmount: config.homeDeliveryFlatFeeAmount,
      pickupInstructions: null,
    });
  }
  return options;
}

// =============================================================================
// Checkout input shapes
// =============================================================================

export interface CheckoutContactInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
}

export interface CheckoutAddressInput {
  label?: string | null;
  street: string;
  number?: string | null;
  floor?: string | null;
  apartment?: string | null;
  postalCode?: string | null;
  city: string;
  province?: string | null;
  country?: string | null;
  notes?: string | null;
}

export interface CreateOrderFromCartInput {
  // Already-resolved, server-derived identity — see this file's own doc
  // comment. Never resolved from cookies/session here.
  cartId: string;
  userId: string | null;
  customerId: string | null;

  contact: CheckoutContactInput;
  deliveryMethod: DeliveryMethod;
  // HOME_DELIVERY only — exactly one of these two, never both. An existing
  // address must belong to `customerId` (ownership enforced below); a
  // guest (customerId === null) can only ever supply a new inline address.
  existingAddressId?: string | null;
  newAddress?: CheckoutAddressInput | null;

  notes?: string | null;

  // Client-generated (crypto.randomUUID() at checkout-page-mount time,
  // resubmitted unchanged on retry) — see Order.idempotencyKey's own schema
  // comment for why a retry returns the SAME Order rather than erroring.
  idempotencyKey: string;
}

export interface CreateOrderFromCartResult {
  order: Order;
  // Returned exactly once — never persisted in plaintext, never
  // retrievable again after this call. The caller (checkout Server Action)
  // embeds it in the /order/[token] redirect.
  rawAccessToken: string;
}

function buildContactName(firstName: string, lastName: string): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
}

function buildVariantDisplayName(variant: {
  name: string | null;
  product: { name: string };
  sizeOption: { label: string } | null;
  color: { displayName: string } | null;
}): string {
  const sizeColor = [variant.sizeOption?.label, variant.color?.displayName].filter(Boolean).join(" / ");
  return sizeColor ? `${variant.product.name} — ${sizeColor}` : variant.product.name;
}

interface ResolvedCheckoutItem {
  productVariantId: string;
  productNameSnapshot: string;
  skuSnapshot: string;
  sizeNameSnapshot: string | null;
  colorNameSnapshot: string | null;
  quantity: number;
  unitPriceAmount: bigint;
  discountAmount: bigint;
  subtotalAmount: bigint;
  totalAmount: bigint;
}

// Phase 1 of checkout (see createOrderFromCart's own comment for the
// two-phase design): re-reads the cart's items fresh from the database,
// re-validates purchasability/price/stock against the CURRENT authoritative
// state, and — for a price change specifically — commits a corrective
// update to CartItem.observedUnitPriceAmount before throwing, so a same-cart
// retry succeeds instead of repeating the same rejection forever. Never
// mutates anything on a stock-shortfall or purchasability rejection (those
// require the customer to actually change their cart, not just retry).
async function validateAndSnapshotCartItems(
  cartId: string,
  warehouseId: string,
): Promise<ResolvedCheckoutItem[]> {
  const items = await prisma.cartItem.findMany({
    where: { cartId },
    include: {
      productVariant: {
        include: {
          sizeOption: true,
          color: true,
          product: { include: { variants: { select: { isActive: true, priceAmount: true } } } },
        },
      },
    },
  });

  if (items.length === 0) throw new EmptyCartError();

  const notPurchasable: string[] = [];
  const priceChanges: PriceChange[] = [];
  const shortfalls: CheckoutStockShortfall[] = [];

  const availableByVariant = await getAvailableToSellForVariants(
    items.map((item) => item.productVariantId),
    warehouseId,
  );

  const resolved: ResolvedCheckoutItem[] = [];

  for (const item of items) {
    const variant = item.productVariant;
    const product = variant.product;
    const displayName = buildVariantDisplayName(variant);

    const productPurchasable = isPubliclyVisible(
      { status: product.status, categoryId: product.categoryId, defaultPriceAmount: product.defaultPriceAmount },
      product.variants,
    );
    if (!variant.isActive || !productPurchasable) {
      notPurchasable.push(displayName);
      continue;
    }

    const currentPrice = getEffectivePrice({
      variantPriceAmount: variant.priceAmount,
      productDefaultPriceAmount: product.defaultPriceAmount,
    });
    if (currentPrice === null || currentPrice <= 0n) {
      notPurchasable.push(displayName);
      continue;
    }
    if (currentPrice !== item.observedUnitPriceAmount) {
      priceChanges.push({
        productVariantId: item.productVariantId,
        displayName,
        previousUnitPriceAmount: item.observedUnitPriceAmount,
        currentUnitPriceAmount: currentPrice,
      });
    }

    const available = availableByVariant.get(item.productVariantId) ?? 0;
    if (available < item.quantity) {
      shortfalls.push({
        productVariantId: item.productVariantId,
        displayName,
        requested: item.quantity,
        available,
      });
    }

    const { subtotalAmount, totalAmount } = computeSaleItemTotals({
      quantity: item.quantity,
      unitPriceAmount: currentPrice,
      discountAmount: 0n,
    });

    resolved.push({
      productVariantId: item.productVariantId,
      productNameSnapshot: product.name,
      skuSnapshot: variant.sku,
      sizeNameSnapshot: variant.sizeOption?.label ?? null,
      colorNameSnapshot: variant.color?.displayName ?? null,
      quantity: item.quantity,
      unitPriceAmount: currentPrice,
      discountAmount: 0n,
      subtotalAmount,
      totalAmount,
    });
  }

  if (notPurchasable.length > 0) throw new CartHasBlockingIssuesError();

  if (priceChanges.length > 0) {
    // A real, committed correction — deliberately NOT rolled back with the
    // rejection below. See this function's own doc comment.
    await Promise.all(
      priceChanges.map((change) =>
        prisma.cartItem.updateMany({
          where: { cartId, productVariantId: change.productVariantId },
          data: { observedUnitPriceAmount: change.currentUnitPriceAmount },
        }),
      ),
    );
    throw new PriceChangedError(priceChanges);
  }

  if (shortfalls.length > 0) throw new InsufficientCheckoutStockError(shortfalls);

  return resolved;
}

async function resolveShippingSnapshot(
  input: CreateOrderFromCartInput,
): Promise<{
  shippingAmount: bigint;
  fields: {
    shippingLabel: string | null;
    shippingStreet: string | null;
    shippingNumber: string | null;
    shippingFloor: string | null;
    shippingApartment: string | null;
    shippingPostalCode: string | null;
    shippingCity: string | null;
    shippingProvince: string | null;
    shippingCountry: string | null;
    shippingNotes: string | null;
  };
}> {
  const emptyFields = {
    shippingLabel: null,
    shippingStreet: null,
    shippingNumber: null,
    shippingFloor: null,
    shippingApartment: null,
    shippingPostalCode: null,
    shippingCity: null,
    shippingProvince: null,
    shippingCountry: null,
    shippingNotes: null,
  };

  if (input.deliveryMethod === "PICKUP") {
    return { shippingAmount: 0n, fields: emptyFields };
  }

  const options = await listAvailableDeliveryMethods();
  const homeDelivery = options.find((o) => o.method === "HOME_DELIVERY");
  if (!homeDelivery) throw new DeliveryMethodNotAvailableError();

  if (input.existingAddressId) {
    if (!input.customerId) throw new AddressNotFoundError();
    const address = await prisma.customerAddress.findUnique({ where: { id: input.existingAddressId } });
    if (!address || address.customerId !== input.customerId) throw new AddressNotFoundError();
    return {
      shippingAmount: homeDelivery.feeAmount,
      fields: {
        shippingLabel: address.label,
        shippingStreet: address.street,
        shippingNumber: address.number,
        shippingFloor: address.floor,
        shippingApartment: address.apartment,
        shippingPostalCode: address.postalCode,
        shippingCity: address.city,
        shippingProvince: address.province,
        shippingCountry: address.country,
        shippingNotes: address.notes,
      },
    };
  }

  if (input.newAddress) {
    const a = input.newAddress;
    if (!a.street.trim() || !a.city.trim()) {
      throw new MissingDeliveryAddressError();
    }
    return {
      shippingAmount: homeDelivery.feeAmount,
      fields: {
        shippingLabel: a.label?.trim() || null,
        shippingStreet: a.street.trim(),
        shippingNumber: a.number?.trim() || null,
        shippingFloor: a.floor?.trim() || null,
        shippingApartment: a.apartment?.trim() || null,
        shippingPostalCode: a.postalCode?.trim() || null,
        shippingCity: a.city.trim(),
        shippingProvince: a.province?.trim() || null,
        shippingCountry: a.country?.trim() || "AR",
        shippingNotes: a.notes?.trim() || null,
      },
    };
  }

  throw new MissingDeliveryAddressError();
}

function assertValidContact(contact: CheckoutContactInput): void {
  if (!contact.firstName.trim() || !contact.lastName.trim()) {
    throw new InvalidContactInfoError("Ingresá tu nombre y apellido.");
  }
  if (!contact.email.trim() || !contact.email.includes("@")) {
    throw new InvalidContactInfoError("Ingresá un email válido.");
  }
}

async function generateOrderCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = buildCandidateOrderCode();
    const collision = await tx.order.count({ where: { code: candidate } });
    if (collision === 0) return candidate;
  }
  throw new Error("No se pudo generar un código de pedido único.");
}

// The one place a Cart becomes an Order. All-or-nothing: either a fully
// valid Order with every item reserved is created, or nothing is (see this
// phase's explicit "do not create an Order with only some variants
// reserved" requirement).
//
// Two-phase design:
//   Phase 1 (validateAndSnapshotCartItems, its own plain reads/writes, NOT
//   part of the commit transaction below): re-validates purchasability,
//   price, and available-to-sell stock against the current authoritative
//   state. A price change is corrected and committed immediately (so a
//   retry succeeds); any other problem throws with zero side effects.
//   Phase 2 (this function's own $transaction): only reached once phase 1
//   found zero problems — creates the Order/OrderItems, atomically reserves
//   stock per item (see modules/inventory/reservation-core.ts's
//   reserveStock — the REAL concurrency guarantee, not the phase-1
//   pre-check, exactly mirroring sale-core.ts's own
//   findStockShortfalls-then-applyInventoryOperation two-layer pattern),
//   and marks the Cart CONVERTED.
//
// Idempotency: checked FIRST, before phase 1 even runs — a retry with the
// same idempotencyKey (double-click, network retry resubmitting the same
// checkout) never creates a second Order. It CANNOT simply return the
// original raw access token, though — only its hash was ever persisted
// (see Order.accessTokenHash's own schema comment), so the true original
// token is genuinely gone the moment the first request's response was
// lost. Instead, a retry ROTATES the token: a fresh one is generated and
// its hash overwrites accessTokenHash, invalidating the old (never
// delivered to anyone, since the response that would have carried it never
// arrived) one. This keeps "exactly one Order per logical checkout" while
// still handing the retrying caller a usable confirmation link.
export async function createOrderFromCart(
  input: CreateOrderFromCartInput,
): Promise<CreateOrderFromCartResult> {
  const existingByIdempotencyKey = await prisma.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existingByIdempotencyKey) {
    const rawAccessToken = generateOrderAccessToken();
    const order = await prisma.order.update({
      where: { id: existingByIdempotencyKey.id },
      data: { accessTokenHash: hashOrderAccessToken(rawAccessToken) },
    });
    return { order, rawAccessToken };
  }

  assertValidContact(input.contact);

  const warehouse = await getDefaultWarehouse();
  if (!warehouse) throw new NoDefaultWarehouseError();

  const resolvedItems = await validateAndSnapshotCartItems(input.cartId, warehouse.id);
  const { shippingAmount, fields: shippingFields } = await resolveShippingSnapshot(input);
  const storeConfig = await getStoreConfiguration();

  const itemTotals = computeSaleTotals(resolvedItems);
  const totalAmount = itemTotals.totalAmount + shippingAmount;

  const rawAccessToken = generateOrderAccessToken();
  const accessTokenHash = hashOrderAccessToken(rawAccessToken);
  const reservationExpiresAt = new Date(Date.now() + RESERVATION_WINDOW_MINUTES * 60_000);

  const order = await prisma.$transaction(async (tx) => {
    const code = await generateOrderCode(tx);

    const created = await tx.order.create({
      data: {
        code,
        customerId: input.customerId,
        userId: input.userId,
        status: "PENDING_PAYMENT",
        paymentStatus: "UNPAID",
        deliveryMethod: input.deliveryMethod,
        warehouseId: warehouse.id,
        currency: storeConfig.currency,
        subtotalAmount: itemTotals.subtotalAmount,
        discountAmount: 0n,
        shippingAmount,
        totalAmount,
        contactNameSnapshot: buildContactName(input.contact.firstName, input.contact.lastName),
        contactEmailSnapshot: input.contact.email.trim().toLowerCase(),
        contactPhoneSnapshot: input.contact.phone?.trim() || null,
        ...shippingFields,
        notes: input.notes?.trim() || null,
        accessTokenHash,
        idempotencyKey: input.idempotencyKey,
        reservationExpiresAt,
        submittedAt: new Date(),
        items: { create: resolvedItems },
      },
    });

    for (const item of resolvedItems) {
      await reserveStock(tx, {
        orderId: created.id,
        productVariantId: item.productVariantId,
        warehouseId: warehouse.id,
        quantity: item.quantity,
        expiresAt: reservationExpiresAt,
      });
    }

    await tx.cart.update({ where: { id: input.cartId }, data: { status: "CONVERTED" } });

    await recordAuditLog(
      {
        userId: input.userId,
        action: "order.submitted",
        entityType: "Order",
        entityId: created.id,
        newValue: {
          code: created.code,
          totalAmount: created.totalAmount.toString(),
          itemCount: resolvedItems.length,
          deliveryMethod: created.deliveryMethod,
        },
      },
      tx,
    );

    return created;
  });

  return { order, rawAccessToken };
}

// =============================================================================
// Read paths
// =============================================================================

const orderDetailInclude = {
  items: { orderBy: { createdAt: "asc" as const } },
  customer: { select: { id: true, code: true, type: true } },
  user: { select: { id: true, name: true, email: true } },
  cancelledBy: { select: { id: true, name: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  reservations: { orderBy: { createdAt: "asc" as const } },
  // Phase — Mercado Pago Checkout Pro integration. Newest first, matching
  // SalePayment's own "most recent activity at the top" convention (see
  // modules/sales/sale-core.ts's getSaleById). One extra JOIN, not a second
  // sequential query — same posture as reservations above, which the
  // public order page already relies on unchanged.
  paymentAttempts: { orderBy: { createdAt: "desc" as const } },
  sale: { select: { id: true, code: true } },
} satisfies Prisma.OrderInclude;

// The public confirmation route's ONE lookup path — see Order.
// accessTokenHash's own schema comment. Token possession alone is
// sufficient authorization for both guest AND authenticated Orders (a
// uniform mechanism, never two separate access models to maintain) — this
// phase deliberately does not build any id-based "my orders" lookup route,
// so "authenticated users may only access their own Orders" holds by
// construction: the only lookup route that exists is this one.
export async function getOrderByAccessToken(rawToken: string) {
  const accessTokenHash = hashOrderAccessToken(rawToken);
  return prisma.order.findUnique({ where: { accessTokenHash }, include: orderDetailInclude });
}

// Admin-only lookup — permission-gated by the caller (requirePermission),
// never itself the security boundary. See app/(admin)/admin/orders/[id]/page.tsx.
export async function getOrderById(id: string) {
  return prisma.order.findUnique({ where: { id }, include: orderDetailInclude });
}

export interface ListOrdersInput {
  search?: string;
  status?: OrderStatus;
  paymentStatus?: OrderPaymentStatus;
  deliveryMethod?: DeliveryMethod;
  take?: number;
  skip?: number;
}

// Search covers order code, the contact-name/email snapshot (never a live
// join for that — the snapshot IS what an Order "shows" as its customer,
// same posture as Sale's own customerNameSnapshot search), and — "where
// available" per this phase's own spec — the linked Customer's document
// number via a live join, since a fiscal document is a find-by key, not
// something this model snapshots historically the way contact info is.
export async function listOrders(input: ListOrdersInput = {}): Promise<{ orders: Order[]; total: number }> {
  const take = input.take ?? 25;
  const skip = input.skip ?? 0;
  const searchTerm = input.search?.trim();

  const where: Prisma.OrderWhereInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
    ...(input.deliveryMethod ? { deliveryMethod: input.deliveryMethod } : {}),
    ...(searchTerm
      ? {
          OR: [
            { code: { contains: searchTerm, mode: "insensitive" } },
            { contactNameSnapshot: { contains: searchTerm, mode: "insensitive" } },
            { contactEmailSnapshot: { contains: searchTerm, mode: "insensitive" } },
            { customer: { documentNumberNormalized: { contains: searchTerm.replace(/\D/g, "") } } },
          ],
        }
      : {}),
  };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({ where, orderBy: { createdAt: "desc" }, take, skip }),
    prisma.order.count({ where }),
  ]);

  return { orders, total };
}

// =============================================================================
// Cancellation — admin-only this phase. See this phase's explicit
// "conservative... otherwise defer" guidance on customer self-cancellation:
// NOT implemented here (no ownership/token-gated self-cancel path exists
// yet) — documented as deferred, not silently missing.
// =============================================================================

export async function cancelOrder(orderId: string, reason: string, actorId: string): Promise<Order> {
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new CancellationReasonRequiredError();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.order.findUnique({ where: { id: orderId } });
    if (!existing) throw new OrderNotFoundError();
    if (existing.status !== "PENDING_PAYMENT") throw new OrderNotCancellableError();

    // Never generates an InventoryMovement — reserved stock was never
    // physically deducted, so there is nothing to reverse (see
    // InventoryReservation's own schema comment).
    await releaseAllActiveReservationsForOrder(tx, orderId, "RELEASED");

    const updated = await tx.order.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: actorId,
        cancellationReason: trimmedReason,
        reservationExpiresAt: null,
      },
    });

    await recordAuditLog(
      {
        userId: actorId,
        action: "order.cancelled",
        entityType: "Order",
        entityId: orderId,
        previousValue: { status: existing.status },
        newValue: { status: "CANCELLED", reason: trimmedReason },
      },
      tx,
    );

    return updated;
  });
}

// =============================================================================
// Expiration — see this phase's explicit "do not invent an unreliable
// client timer as the authority" requirement: this is the one real
// authority, invoked opportunistically (see this file's callers: checkout
// submission and the admin Orders list) rather than on a scheduler, which
// does not exist yet in this codebase — see this phase's final report for
// what still needs real cron scheduling.
// =============================================================================

// Re-checks and, if genuinely stale, expires ONE Order — the exact
// per-order transaction body expireStaleOrdersAndReservations loops over,
// extracted so a single-Order caller (createMercadoPagoPreference — see
// this phase's explicit "expire stale Order first if necessary"
// requirement) never has to run the whole sweep's query just to check one
// Order. Safe to call on an Order that's already EXPIRED, PAID, CANCELLED,
// or still genuinely ACTIVE — only mutates when status is PENDING_PAYMENT
// AND reservationExpiresAt has genuinely passed; every other case is a
// pure, side-effect-free read.
export async function expireOrderIfStale(orderId: string): Promise<{ order: Order; justExpired: boolean }> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new OrderNotFoundError();

    const isStale =
      order.status === "PENDING_PAYMENT" &&
      order.reservationExpiresAt !== null &&
      order.reservationExpiresAt < new Date();
    if (!isStale) return { order, justExpired: false };

    await releaseAllActiveReservationsForOrder(tx, orderId, "EXPIRED");
    const updated = await tx.order.update({
      where: { id: orderId },
      data: { status: "EXPIRED", reservationExpiresAt: null },
    });
    await recordAuditLog(
      { userId: null, action: "order.expired", entityType: "Order", entityId: orderId },
      tx,
    );
    return { order: updated, justExpired: true };
  });
}

export async function expireStaleOrdersAndReservations(): Promise<{ expiredOrderCount: number }> {
  const now = new Date();
  const stale = await prisma.order.findMany({
    where: { status: "PENDING_PAYMENT", reservationExpiresAt: { lt: now } },
    select: { id: true },
  });

  let expiredCount = 0;
  for (const { id } of stale) {
    // Re-checked inside expireOrderIfStale's own transaction: avoids
    // double-expiring an Order an admin cancellation (or a concurrent sweep
    // run) already moved out of PENDING_PAYMENT in the moment between the
    // query above and that transaction opening.
    const { justExpired } = await expireOrderIfStale(id);
    if (justExpired) expiredCount += 1;
  }

  return { expiredOrderCount: expiredCount };
}

// Phase — Mercado Pago Real Sandbox Validation + Reservation Scheduler.
// Admin-facing readiness only — booleans/numbers, never a secret value (see
// this phase's own "never expose INTERNAL_TASK_SECRET" requirement).
// internalEndpointConfigured reflects whether POST /api/internal/
// expire-stale-orders CAN be securely invoked (INTERNAL_TASK_SECRET is set —
// see that route's own isAuthorized) — it is deliberately NOT proof that a
// real external scheduler is actually calling it on an interval; this
// application has no way to observe that from inside itself without adding
// persistence purely to decorate a status line (which this phase's own
// "do not add DB persistence solely for decorative status" instruction
// rules out) — see this module's own admin card for the exact caveat shown
// to the admin.
export interface ReservationSchedulerReadiness {
  reservationWindowMinutes: number;
  internalEndpointConfigured: boolean;
}

export function getReservationSchedulerReadiness(): ReservationSchedulerReadiness {
  return {
    reservationWindowMinutes: RESERVATION_WINDOW_MINUTES,
    internalEndpointConfigured: Boolean(env.INTERNAL_TASK_SECRET),
  };
}

// =============================================================================
// Mercado Pago Checkout Pro integration — the ONE place an approved online
// payment becomes a real Sale. The only caller is modules/payments/
// mercado-pago/reconcile-core.ts's reconcileMercadoPagoPayment, which
// resolves Mercado-Pago-specific concepts (preference/payment ids, provider
// status strings) into the provider-agnostic FinalizePaidOrderPaymentContext
// below BEFORE calling this — Mercado Pago itself never leaks into this
// module (see this integration's "provider abstraction" requirement).
//
// Responsibilities, all inside ONE atomic transaction (see
// finalizePaidOrderTransactionally below) — no partial finalization:
//   1. lock the Order row (SELECT ... FOR UPDATE), verify it has not
//      already been finalized (idempotent no-op if so — see "already_
//      finalized" below);
//   2. verify amount/currency against the Order's own authoritative
//      totalAmount/currency (never the browser, never trusted provider
//      metadata alone) — a mismatch NEVER creates a Sale; it marks the
//      Order for admin review instead (see requiresPaymentReview);
//   3. resolve which commercial Customer the resulting Sale belongs to
//      (see resolveCustomerForFinalization);
//   4. release this Order's ACTIVE reservation(s) — see this function's own
//      "release-then-deduct" note for why that order matters;
//   5. create a DRAFT Sale + SaleItems from the Order's own item SNAPSHOTS
//      (never re-resolved current product data — same "a later product
//      change must never rewrite a historical record" posture as
//      SaleItem/OrderItem's own snapshot fields), linked back via
//      Sale.orderId;
//   6. confirm the Sale (confirmSaleWithinTransaction) — the ONLY point
//      reserved stock actually becomes a real InventoryMovement
//      (MovementType.SALE), converting the commitment into a physical
//      deduction; this is ALSO the late-payment stock guard (see below);
//   7. register a SalePayment reflecting the approved payment
//      (registerSalePaymentWithinTransaction) — same payment architecture
//      as every other Sale payment, never a parallel system;
//   8. mark the Order PAID.
//
// Late-payment policy (Mercado Pago reports APPROVED after this Order's
// reservation already expired/was released): step 4 above still runs (a
// no-op for an already-non-ACTIVE reservation — see releaseReservation's own
// idempotency), and step 6's guarded SALE deduction simply checks CURRENT
// available-to-sell stock, exactly as it would for any Sale. If enough
// remains, this IS the "controlled re-acquisition" — the Order finalizes
// normally. If not, confirmSaleWithinTransaction throws
// InsufficientSaleStockError, which finalizePaidOrder (the outer function,
// below) catches OUTSIDE this failed/rolled-back transaction and marks the
// Order for review in a fresh, always-safe transaction — never a negative
// balance, never a silently-ignored approved payment, never a Sale created
// on a partial/failed attempt.
//
// Idempotency/concurrency: the Order-row lock is the real guarantee —
// mirrors modules/sales/payment-core.ts's registerSalePayment's own
// `SELECT ... FOR UPDATE` idiom exactly. Two concurrent finalization
// attempts for the SAME Order (duplicate webhook, webhook racing an admin
// "Verificar pago" retry) serialize on that lock; the second, once
// unblocked, re-reads status === "PAID" and returns "already_finalized"
// without touching Sale/inventory again. Sale.orderId's own DB-level
// @unique constraint (see that field's schema comment) is the second,
// independent safety net beyond this lock.
// =============================================================================

export class NoSystemDefaultCustomerError extends Error {
  constructor() {
    super(
      "No hay un cliente del sistema configurado (Consumidor Final). Ejecutá el seed de la base de datos.",
    );
    this.name = "NoSystemDefaultCustomerError";
  }
}

// The provider-agnostic shape reconcile-core.ts hands to finalizePaidOrder —
// see this module's own "provider abstraction" note above. `provider` is a
// literal union (not the Prisma PaymentAttemptProvider enum type) so this
// file never needs to import anything from the payments module at all.
export interface FinalizePaidOrderPaymentContext {
  provider: "MERCADO_PAGO";
  attemptId: string;
  providerPaymentId: string;
  // Minor units — already converted from the provider's response by the
  // caller (see modules/payments/mercado-pago/amount-core.ts); never a
  // float comparison against Order.totalAmount.
  approvedAmount: bigint;
  approvedCurrency: string;
  approvedAt: Date;
}

export interface FinalizePaidOrderInput {
  orderId: string;
  paymentContext: FinalizePaidOrderPaymentContext;
}

export type FinalizePaidOrderOutcome = "finalized" | "already_finalized" | "requires_review";

export interface FinalizePaidOrderResult {
  order: Order;
  sale: Sale | null;
  outcome: FinalizePaidOrderOutcome;
}

// Resolves which commercial Customer the finalized Sale belongs to. An
// authenticated checkout already resolved this at Order-creation time
// (Order.customerId) — reused directly, unchanged. A guest Order
// (customerId null) applies the SAME soft (email/phone) duplicate-detection
// policy the admin customer-creation form uses (see modules/customers/
// customer-core.ts's findPossibleDuplicateCustomers): an ambiguous match is
// NEVER auto-merged into an existing Customer — it falls back to the system
// default customer ("Consumidor Final", the same role POS gives an
// unidentified walk-in sale) instead of guessing which existing Customer
// this guest actually is. Either way, the Sale's own customerNameSnapshot
// below is always the guest's real typed name from the Order's own contact
// snapshot — never discarded, even when the FK falls back to Consumidor
// Final. No ambiguity: safe to auto-create a real commercial Customer from
// the paid guest Order's contact snapshot, via the existing Customer
// service (never a hand-rolled insert) — `confirmed: true` is safe here
// specifically because the duplicate check just above already ran, inside
// this same transaction.
async function resolveCustomerForFinalization(
  tx: Prisma.TransactionClient,
  order: Order,
  systemActorId: string,
): Promise<string> {
  if (order.customerId) return order.customerId;

  const matches = await findPossibleDuplicateCustomers(
    { email: order.contactEmailSnapshot, phone: order.contactPhoneSnapshot },
    tx,
  );
  if (matches.length > 0) {
    const fallback = await tx.customer.findFirst({ where: { isSystemDefault: true } });
    if (!fallback) throw new NoSystemDefaultCustomerError();
    return fallback.id;
  }

  const [firstName, ...rest] = order.contactNameSnapshot.trim().split(/\s+/);
  const result = await createCustomer(
    {
      type: "PERSON",
      firstName: firstName || null,
      lastName: rest.length > 0 ? rest.join(" ") : null,
      email: order.contactEmailSnapshot,
      phone: order.contactPhoneSnapshot,
    },
    systemActorId,
    { confirmed: true },
    tx,
  );
  if (result.status !== "created") {
    throw new Error("unreachable: createCustomer with confirmed:true never returns possible_duplicates");
  }
  return result.customer.id;
}

interface OrderLockRow {
  id: string;
  status: OrderStatus;
  requiresPaymentReview: boolean;
  totalAmount: bigint;
  currency: string;
}

// Shared by every "this payment cannot be safely finalized" branch below —
// amount/currency mismatch, an approved payment for an already-CANCELLED
// Order, an unexpected Order status, or (called separately, from OUTSIDE a
// rolled-back finalization attempt — see finalizePaidOrder itself) genuine
// late-payment insufficient stock. Never silently drops the payment: always
// flags Order.requiresPaymentReview and marks the attempt
// FAILED_RECONCILIATION, per this integration's explicit "surface it for
// admin review" requirement.
async function markOrderPaymentRequiresReviewWithinTransaction(
  tx: Prisma.TransactionClient,
  orderId: string,
  attemptId: string,
  failureCode: string,
  reviewReason: string,
): Promise<FinalizePaidOrderResult> {
  const order = await tx.order.update({
    where: { id: orderId },
    data: { requiresPaymentReview: true, paymentReviewReason: reviewReason },
  });
  await tx.orderPaymentAttempt.update({
    where: { id: attemptId },
    data: { status: "FAILED_RECONCILIATION", failureCode, failureDetail: reviewReason },
  });
  await recordAuditLog(
    {
      userId: null,
      action: "order.payment_requires_review",
      entityType: "Order",
      entityId: orderId,
      newValue: { failureCode },
    },
    tx,
  );
  return { order, sale: null, outcome: "requires_review" };
}

async function finalizePaidOrderTransactionally(
  input: FinalizePaidOrderInput,
  systemActorId: string,
  defaultTaxCategory: FiscalTaxCategory | null,
): Promise<FinalizePaidOrderResult> {
  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<OrderLockRow[]>`
      SELECT id, status, "requiresPaymentReview", "totalAmount", currency
      FROM "order" WHERE id = ${input.orderId} FOR UPDATE
    `;
    if (!locked) throw new OrderNotFoundError();

    if (locked.status === "PAID") {
      const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
      const sale = await tx.sale.findUnique({ where: { orderId: input.orderId } });
      return { order, sale, outcome: "already_finalized" as const };
    }

    if (locked.requiresPaymentReview) {
      const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });
      return { order, sale: null, outcome: "requires_review" as const };
    }

    // Mandatory amount/currency verification — see this integration's
    // explicit "verify amount" requirement. Compared against the Order's
    // own authoritative, immutable-after-creation totalAmount/currency,
    // never the OrderPaymentAttempt's cached snapshot (see that model's own
    // comment) and never trusted from the provider notification alone.
    const currencyMismatch = locked.currency.toUpperCase() !== input.paymentContext.approvedCurrency.toUpperCase();
    const amountMismatch = locked.totalAmount !== input.paymentContext.approvedAmount;
    if (currencyMismatch || amountMismatch) {
      return markOrderPaymentRequiresReviewWithinTransaction(
        tx,
        input.orderId,
        input.paymentContext.attemptId,
        currencyMismatch ? "CURRENCY_MISMATCH" : "AMOUNT_MISMATCH",
        "El pago recibido no coincide con el importe del pedido. Requiere revisión manual.",
      );
    }

    if (locked.status === "CANCELLED") {
      // A genuinely approved payment for an already-cancelled Order — never
      // silently ignored (see this integration's explicit requirement).
      return markOrderPaymentRequiresReviewWithinTransaction(
        tx,
        input.orderId,
        input.paymentContext.attemptId,
        "ORDER_CANCELLED",
        "Se recibió un pago aprobado para un pedido cancelado. Requiere revisión manual.",
      );
    }

    if (locked.status !== "PENDING_PAYMENT" && locked.status !== "EXPIRED") {
      // Defensive: no code path in this codebase currently moves an Order
      // into any other status before payment, but a future fulfillment
      // phase might — never silently finalize on top of an unanticipated
      // state.
      return markOrderPaymentRequiresReviewWithinTransaction(
        tx,
        input.orderId,
        input.paymentContext.attemptId,
        "UNEXPECTED_ORDER_STATUS",
        `Se recibió un pago aprobado para un pedido en estado inesperado (${locked.status}). Requiere revisión manual.`,
      );
    }

    // status is PENDING_PAYMENT (ordinary, on-time payment) or EXPIRED (a
    // late approval — see this function's own "late-payment policy" note
    // above) — both proceed through the identical path below.
    const order = await tx.order.findUniqueOrThrow({ where: { id: input.orderId } });

    const activeReservations = await tx.inventoryReservation.findMany({
      where: { orderId: order.id, status: "ACTIVE" },
    });
    // Release-THEN-deduct, never the reverse: releasing this Order's own
    // reservation FIRST ensures confirmSaleWithinTransaction's guarded SALE
    // deduction (quantity - reservedQuantity + delta >= 0) is never
    // computed against this Order's OWN still-counted reservation, which
    // could otherwise spuriously reject a legitimate sale of stock this
    // Order itself already holds (an edge case when it reserved the last
    // available units — the arithmetic only works out safely once this
    // reservation's own contribution to reservedQuantity is already
    // removed). A no-op for an already-EXPIRED/RELEASED reservation (the
    // late-payment case) — see releaseReservation's own idempotency.
    for (const reservation of activeReservations) {
      await releaseReservation(tx, reservation.id, "CONSUMED");
    }

    const customerId = await resolveCustomerForFinalization(tx, order, systemActorId);
    const items = await tx.orderItem.findMany({
      where: { orderId: order.id },
      include: { productVariant: { select: { product: { select: { taxCategory: true } } } } },
    });

    let sale = await tx.sale.create({
      data: {
        code: await generateSaleCode(tx),
        orderId: order.id,
        customerId,
        warehouseId: order.warehouseId,
        createdById: systemActorId,
        status: "DRAFT",
        // Always the guest/authenticated customer's own real typed name
        // from the Order's own contact snapshot — see this function's own
        // comment above for why this is never derived from the resolved
        // Customer (which may be the Consumidor Final fallback).
        customerNameSnapshot: order.contactNameSnapshot,
        // Guest/authenticated checkout never collects a fiscal document —
        // genuinely nothing to snapshot here, unlike a POS sale.
        customerDocumentSnapshot: null,
        subtotalAmount: order.subtotalAmount,
        discountTotalAmount: order.discountAmount,
        taxTotalAmount: 0n,
        totalAmount: order.totalAmount,
        notes: `Pedido online ${order.code} — pagado con Mercado Pago.`,
        items: {
          // Same tax-category snapshot resolution as modules/sales/
          // sale-core.ts's resolveSaleItem (Product override, else the
          // store default resolved once above by the caller) — an online
          // Order's SaleItem must be just as fiscally reconstructable as a
          // POS one; leaving this permanently null for every online sale
          // would be a real gap, not a cosmetic one. Never re-derived once
          // written.
          create: items.map((item) => {
            const { taxCategory, taxRateBasisPoints } = resolveSaleItemTaxSnapshot({
              productOverride: item.productVariant.product.taxCategory,
              storeDefault: defaultTaxCategory,
            });
            return {
              productVariantId: item.productVariantId,
              productNameSnapshot: item.productNameSnapshot,
              skuSnapshot: item.skuSnapshot,
              quantity: item.quantity,
              unitPriceAmount: item.unitPriceAmount,
              discountAmount: item.discountAmount,
              subtotalAmount: item.subtotalAmount,
              totalAmount: item.totalAmount,
              taxCategory,
              taxRateBasisPoints,
            };
          }),
        },
      },
    });

    // The real physical stock deduction — may throw
    // InsufficientSaleStockError for a genuine late-payment/insufficient-
    // stock case (see this function's own doc comment); caught by the
    // outer finalizePaidOrder, OUTSIDE this transaction, which then rolls
    // this entire attempt back and marks the Order for review instead.
    sale = await confirmSaleWithinTransaction(tx, sale.id, systemActorId);

    await registerSalePaymentWithinTransaction(
      tx,
      {
        saleId: sale.id,
        method: "MERCADO_PAGO",
        amount: input.paymentContext.approvedAmount,
        reference: input.paymentContext.providerPaymentId,
        notes: "Pago aprobado por Mercado Pago.",
        paidAt: input.paymentContext.approvedAt,
        // Deterministic, not client-generated (there is no client here) —
        // keyed to the provider payment id itself, so even an extremely
        // unlikely double-invocation that somehow bypassed the Order-row
        // lock above would still collide on SalePayment.idempotencyKey's
        // own unique constraint rather than double-register.
        idempotencyKey: `mp-payment:${input.paymentContext.providerPaymentId}`,
      },
      systemActorId,
    );

    const updatedOrder = await tx.order.update({
      where: { id: order.id },
      data: { status: "PAID", paymentStatus: "PAID", reservationExpiresAt: null },
    });

    await tx.orderPaymentAttempt.update({
      where: { id: input.paymentContext.attemptId },
      data: {
        status: "APPROVED",
        providerPaymentId: input.paymentContext.providerPaymentId,
        approvedAt: input.paymentContext.approvedAt,
      },
    });

    await recordAuditLog(
      {
        userId: systemActorId,
        action: "order.paid",
        entityType: "Order",
        entityId: order.id,
        previousValue: { status: order.status },
        newValue: { status: "PAID", saleId: sale.id },
        metadata: { provider: "MERCADO_PAGO", providerPaymentId: input.paymentContext.providerPaymentId },
      },
      tx,
    );

    return { order: updatedOrder, sale, outcome: "finalized" as const };
  });
}

export async function finalizePaidOrder(input: FinalizePaidOrderInput): Promise<FinalizePaidOrderResult> {
  const systemActorId = await getSystemAccountUserId();
  // Resolved once, outside the transaction — same posture as
  // modules/sales/sale-core.ts's createSale/updateSale.
  const { defaultTaxCategory } = await getStoreConfiguration();

  try {
    return await finalizePaidOrderTransactionally(input, systemActorId, defaultTaxCategory);
  } catch (error) {
    if (error instanceof InsufficientSaleStockError) {
      // The finalization transaction above already rolled back in full —
      // zero Sale/inventory side effects. This is a fresh, independent,
      // always-safe transaction (no Sale/inventory write here at all), so
      // it never needs the "roll back everything" guarantee the failed
      // attempt required.
      return prisma.$transaction((tx) =>
        markOrderPaymentRequiresReviewWithinTransaction(
          tx,
          input.orderId,
          input.paymentContext.attemptId,
          "INSUFFICIENT_STOCK",
          "Pago aprobado, pero no hay stock suficiente para completar el pedido. Requiere revisión manual.",
        ),
      );
    }
    throw error;
  }
}
