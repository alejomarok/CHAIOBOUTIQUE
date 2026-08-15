import type { Customer, CustomerAddress, CustomerType, Prisma } from "@/generated/prisma/client";
import { Prisma as PrismaRuntime } from "@/generated/prisma/client";
import { prisma } from "@/lib/db-core";
import { recordAuditLog } from "@/modules/audit/index-core";

import {
  getCustomerDisplayName,
  normalizeEmail,
  normalizePhone,
  normalizeStrongIdentifier,
} from "./normalize";
import { buildCandidateCustomerRecordCode } from "./record-code";

// Node-safe core: no "server-only" import, and imports db-core.ts/
// audit/index-core.ts (not the "server-only"-guarded wrappers) so this stays
// importable from a plain Node context (Playwright's test-runner process,
// prisma/seed.ts via tsx) — see src/modules/customers/customer.ts and
// ARCHITECTURE.md. Mirrors the exact -core/wrapper split every other
// feature module uses (warehouses, attributes, categories, ...).

export class CustomerNotFoundError extends Error {
  constructor() {
    super("Cliente no encontrado.");
    this.name = "CustomerNotFoundError";
  }
}

// Application-level enforcement only — same documented-soft-enforcement
// posture as Role.isSystem/Warehouse defaults. "Consumidor Final" must
// never become "just another editable person" (see this phase's own
// instructions), so every mutating function below checks isSystemDefault
// before touching identity-defining fields, deactivating, or unlinking.
export class SystemCustomerProtectedError extends Error {
  constructor() {
    super("Consumidor Final es un cliente del sistema y no puede editarse ni eliminarse.");
    this.name = "SystemCustomerProtectedError";
  }
}

export class DuplicateCustomerDocumentError extends Error {
  constructor() {
    super("Ya existe un cliente con este número de documento.");
    this.name = "DuplicateCustomerDocumentError";
  }
}

export class DuplicateCustomerTaxIdError extends Error {
  constructor() {
    super("Ya existe un cliente con este CUIT.");
    this.name = "DuplicateCustomerTaxIdError";
  }
}

export class UserAlreadyLinkedError extends Error {
  constructor() {
    super("Esta cuenta ya está vinculada a otro cliente.");
    this.name = "UserAlreadyLinkedError";
  }
}

export class CustomerAlreadyLinkedError extends Error {
  constructor() {
    super("Este cliente ya tiene una cuenta vinculada. Desvinculala primero.");
    this.name = "CustomerAlreadyLinkedError";
  }
}

export class AddressNotFoundError extends Error {
  constructor() {
    super("Dirección no encontrada.");
    this.name = "AddressNotFoundError";
  }
}

// True for a P2002 (unique constraint violation) whose target implicates
// every field named. Checked against every shape actually observed for
// this: `error.meta.target` (array or string, depending on constraint —
// same defensive-both-shapes approach as modules/imports/row-processors.ts's
// isUniqueConstraintViolation) AND, empirically required for Prisma 7 +
// @prisma/adapter-pg specifically,
// `error.meta.driverAdapterError.cause.constraint.fields` — an array of
// double-quoted column names (e.g. `"documentType"`) the Postgres driver
// adapter reports the raw constraint violation under instead of populating
// `target` at all. Verified against a real P2002 from this exact
// constraint, not assumed from documentation.
function isUniqueConstraintOn(error: unknown, fields: string[]): boolean {
  if (!(error instanceof PrismaRuntime.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const meta = error.meta as
    | { target?: unknown; driverAdapterError?: { cause?: { constraint?: { fields?: unknown } } } }
    | undefined;

  const candidates: unknown[] = [meta?.target, meta?.driverAdapterError?.cause?.constraint?.fields];

  return candidates.some((candidate) => {
    if (Array.isArray(candidate)) {
      const normalized = candidate.map((entry) => String(entry).replace(/"/g, ""));
      return fields.every((field) => normalized.includes(field));
    }
    if (typeof candidate === "string") {
      return fields.every((field) => candidate.includes(field));
    }
    return false;
  });
}

async function generateCustomerRecordCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = buildCandidateCustomerRecordCode();
    const collision = await tx.customer.count({ where: { code: candidate } });
    if (collision === 0) return candidate;
  }
  throw new Error("No se pudo generar un código de cliente único.");
}

// Called from within modules/customers/service.ts's registerCustomer
// transaction — the one place a User row becomes a full customer account.
// Every self-registered web account gets a linked Customer automatically
// (this is NOT "automatic merging": it's a 1:1 creation for a brand-new
// User row, so there is no matching/merge risk at all — see schema.prisma's
// Customer model comment for the documented policy). Idempotent: if a
// Customer is already linked to this userId (e.g. a repeated
// reconcileAbandonedRegistrations pass), returns it unchanged rather than
// creating a second one. Reads name/email from the User row itself, never
// from a second, potentially-stale copy the caller might pass — User is
// already the source of truth for both at this point in the flow.
export async function createCustomerForRegisteredUser(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<Customer> {
  const existing = await tx.customer.findUnique({ where: { linkedUserId: userId } });
  if (existing) return existing;

  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { name: true, email: true },
  });

  const [firstName, ...rest] = user.name.trim().split(/\s+/);
  const lastName = rest.length > 0 ? rest.join(" ") : null;

  const customer = await tx.customer.create({
    data: {
      code: await generateCustomerRecordCode(tx),
      type: "PERSON",
      firstName: firstName || null,
      lastName,
      email: normalizeEmail(user.email),
      linkedUserId: userId,
      isActive: true,
    },
  });

  await recordAuditLog(
    {
      userId: null,
      action: "customer.created",
      entityType: "Customer",
      entityId: customer.id,
      newValue: { code: customer.code },
      metadata: { source: "public_registration" },
    },
    tx,
  );

  return customer;
}

export interface CreateCustomerInput {
  type: CustomerType;
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  taxId?: string | null;
  taxCondition?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

export interface PossibleDuplicateMatch {
  id: string;
  displayName: string;
  documentNumber: string | null;
  email: string | null;
  phone: string | null;
  matchedOn: Array<"email" | "phone">;
}

// Soft-signal only (email/phone) — DNI/CUIT are the STRONG identifiers and
// are hard-blocked by a real DB unique constraint instead (see
// schema.prisma's Customer model and createCustomer's own error handling
// below), never just warned about. Never merges anything — this only
// returns candidates for a human to review via "Ver cliente existente" /
// "Continuar de todos modos" in the admin UI. excludeCustomerId lets the
// edit form run the same check without a customer always "matching itself".
export async function findPossibleDuplicateCustomers(input: {
  email?: string | null;
  phone?: string | null;
  excludeCustomerId?: string;
}): Promise<PossibleDuplicateMatch[]> {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  if (!email && !phone) return [];

  const orConditions: Prisma.CustomerWhereInput[] = [];
  if (email) orConditions.push({ email });
  if (phone) orConditions.push({ phone });

  const candidates = await prisma.customer.findMany({
    where: {
      OR: orConditions,
      ...(input.excludeCustomerId ? { id: { not: input.excludeCustomerId } } : {}),
    },
    select: {
      id: true,
      type: true,
      firstName: true,
      lastName: true,
      businessName: true,
      documentNumber: true,
      email: true,
      phone: true,
    },
    take: 5,
  });

  return candidates.map((candidate) => ({
    id: candidate.id,
    displayName: getCustomerDisplayName(candidate),
    documentNumber: candidate.documentNumber,
    email: candidate.email,
    phone: candidate.phone,
    matchedOn: [
      ...(email && candidate.email === email ? (["email"] as const) : []),
      ...(phone && candidate.phone === phone ? (["phone"] as const) : []),
    ],
  }));
}

export type CreateCustomerResult =
  | { status: "created"; customer: Customer }
  | { status: "possible_duplicates"; matches: PossibleDuplicateMatch[] };

// The admin-facing creation path (POST /admin/customers/new). Two-phase by
// design, matching this phase's exact required UX: a first call (no
// `confirmed`) that finds a soft (email/phone) match returns
// "possible_duplicates" instead of creating anything — the caller must
// resubmit with `confirmed: true` ("Continuar de todos modos") to actually
// create the row. A STRONG identifier collision (exact document+type or
// exact CUIT match) is never something `confirmed` can bypass — it's a real
// DB unique constraint, translated into a friendly, specific error instead.
export async function createCustomer(
  input: CreateCustomerInput,
  actorId: string,
  options: { confirmed?: boolean } = {},
): Promise<CreateCustomerResult> {
  if (!options.confirmed) {
    const matches = await findPossibleDuplicateCustomers({ email: input.email, phone: input.phone });
    if (matches.length > 0) {
      return { status: "possible_duplicates", matches };
    }
  }

  // documentType/documentNumber are PERSON-only (a COMPANY's fiscal
  // identifier is taxId/CUIT — see this phase's exact COMPANY form spec,
  // which has no document type/number field at all) — gated the same way
  // firstName/lastName/businessName are, so switching type never leaves a
  // stale document number attached to the wrong kind of customer.
  const isPerson = input.type === "PERSON";
  const documentNumberNormalized = isPerson
    ? normalizeStrongIdentifier(input.documentNumber)
    : null;
  const taxIdNormalized = normalizeStrongIdentifier(input.taxId);

  try {
    const customer = await prisma.customer.create({
      data: {
        code: await generateCustomerRecordCode(prisma),
        type: input.type,
        firstName: isPerson ? (input.firstName ?? null) : null,
        lastName: isPerson ? (input.lastName ?? null) : null,
        businessName: input.type === "COMPANY" ? (input.businessName ?? null) : null,
        documentType: isPerson ? input.documentType || null : null,
        documentNumber: isPerson ? input.documentNumber || null : null,
        documentNumberNormalized,
        taxId: input.taxId || null,
        taxIdNormalized,
        taxCondition: input.taxCondition || null,
        email: normalizeEmail(input.email),
        phone: normalizePhone(input.phone),
        notes: input.notes || null,
        createdById: actorId,
      },
    });

    await recordAuditLog({
      userId: actorId,
      action: "customer.created",
      entityType: "Customer",
      entityId: customer.id,
      newValue: { code: customer.code, type: customer.type },
    });

    return { status: "created", customer };
  } catch (error) {
    if (isUniqueConstraintOn(error, ["documentType", "documentNumberNormalized"])) {
      throw new DuplicateCustomerDocumentError();
    }
    if (isUniqueConstraintOn(error, ["taxIdNormalized"])) {
      throw new DuplicateCustomerTaxIdError();
    }
    throw error;
  }
}

export interface UpdateCustomerInput {
  type?: CustomerType;
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  taxId?: string | null;
  taxCondition?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
}

async function assertNotSystemCustomer(id: string): Promise<Customer> {
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) throw new CustomerNotFoundError();
  if (customer.isSystemDefault) throw new SystemCustomerProtectedError();
  return customer;
}

export type UpdateCustomerResult =
  | { status: "updated"; customer: Customer }
  | { status: "possible_duplicates"; matches: PossibleDuplicateMatch[] };

// Same two-phase possible-duplicate flow as createCustomer (see that
// function's comment) — required for edits too, not just creation: a staff
// member correcting/adding an email or phone to an existing record could
// just as easily reveal that it matches someone else already in the
// system. Only checked when email/phone actually change in this call
// (skips the check entirely if neither is part of the update), and always
// excludes the customer being edited from its own results.
export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
  actorId: string,
  options: { confirmed?: boolean } = {},
): Promise<UpdateCustomerResult> {
  const existing = await assertNotSystemCustomer(id);
  const type = input.type ?? existing.type;

  if (!options.confirmed && (input.email !== undefined || input.phone !== undefined)) {
    const matches = await findPossibleDuplicateCustomers({
      email: input.email !== undefined ? input.email : existing.email,
      phone: input.phone !== undefined ? input.phone : existing.phone,
      excludeCustomerId: id,
    });
    if (matches.length > 0) {
      return { status: "possible_duplicates", matches };
    }
  }

  // Same PERSON-only gating as createCustomer — a type change (PERSON ->
  // COMPANY) always clears document fields rather than leaving a stale
  // value attached to the wrong kind of customer, even if the caller's
  // payload still technically included one (e.g. a hidden, unmounted form
  // field react-hook-form retained the last value of).
  const isPerson = type === "PERSON";
  const documentNumberNormalized =
    isPerson && input.documentNumber !== undefined
      ? normalizeStrongIdentifier(input.documentNumber)
      : !isPerson
        ? null
        : undefined;
  const taxIdNormalized =
    input.taxId !== undefined ? normalizeStrongIdentifier(input.taxId) : undefined;

  try {
    const customer = await prisma.customer.update({
      where: { id },
      data: {
        type,
        firstName: isPerson ? (input.firstName ?? existing.firstName) : null,
        lastName: isPerson ? (input.lastName ?? existing.lastName) : null,
        businessName: type === "COMPANY" ? (input.businessName ?? existing.businessName) : null,
        documentType: isPerson ? (input.documentType ?? existing.documentType) || null : null,
        documentNumber: isPerson ? (input.documentNumber ?? existing.documentNumber) || null : null,
        ...(documentNumberNormalized !== undefined ? { documentNumberNormalized } : {}),
        ...(input.taxId !== undefined ? { taxId: input.taxId || null, taxIdNormalized } : {}),
        ...(input.taxCondition !== undefined ? { taxCondition: input.taxCondition || null } : {}),
        ...(input.email !== undefined ? { email: normalizeEmail(input.email) } : {}),
        ...(input.phone !== undefined ? { phone: normalizePhone(input.phone) } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
      },
    });

    await recordAuditLog({
      userId: actorId,
      action: "customer.updated",
      entityType: "Customer",
      entityId: id,
      previousValue: {
        type: existing.type,
        documentType: existing.documentType,
        documentNumber: existing.documentNumber,
        taxId: existing.taxId,
        email: existing.email,
        phone: existing.phone,
      },
      newValue: { ...input },
    });

    return { status: "updated", customer };
  } catch (error) {
    if (isUniqueConstraintOn(error, ["documentType", "documentNumberNormalized"])) {
      throw new DuplicateCustomerDocumentError();
    }
    if (isUniqueConstraintOn(error, ["taxIdNormalized"])) {
      throw new DuplicateCustomerTaxIdError();
    }
    throw error;
  }
}

export async function deactivateCustomer(id: string, actorId: string): Promise<Customer> {
  await assertNotSystemCustomer(id);
  const customer = await prisma.customer.update({ where: { id }, data: { isActive: false } });
  await recordAuditLog({
    userId: actorId,
    action: "customer.deactivated",
    entityType: "Customer",
    entityId: id,
  });
  return customer;
}

export async function activateCustomer(id: string, actorId: string): Promise<Customer> {
  const existing = await prisma.customer.findUnique({ where: { id } });
  if (!existing) throw new CustomerNotFoundError();
  const customer = await prisma.customer.update({ where: { id }, data: { isActive: true } });
  await recordAuditLog({
    userId: actorId,
    action: "customer.activated",
    entityType: "Customer",
    entityId: id,
  });
  return customer;
}

export async function getCustomerById(id: string) {
  return prisma.customer.findUnique({
    where: { id },
    include: {
      addresses: { orderBy: [{ isDefaultShipping: "desc" }, { createdAt: "asc" }] },
      linkedUser: { select: { id: true, name: true, email: true, emailVerified: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
}

// "Consumidor Final" — see seed-core.ts's seedConsumidorFinal. Used by the
// Sales/POS foundation to default a new sale's customer picker to a real
// row without hard-coding its id/code anywhere outside this lookup.
export async function getSystemDefaultCustomer() {
  return prisma.customer.findFirst({ where: { isSystemDefault: true } });
}

export interface ListCustomersInput {
  search?: string;
  type?: CustomerType;
  status?: "active" | "inactive";
  take?: number;
  skip?: number;
}

// Search covers every field the "how do I find someone" requirement names
// (name/surname/business name/DNI/CUIT/email/phone) in one query — never
// N+1 per row (see this phase's performance requirement). A search term
// that normalizes to digits also matches document/tax numbers regardless of
// how the admin typed it (with or without dots/dashes).
export async function listCustomers(
  input: ListCustomersInput = {},
): Promise<{ customers: Customer[]; total: number }> {
  const take = input.take ?? 25;
  const skip = input.skip ?? 0;

  const searchTerm = input.search?.trim();
  const normalizedDigits = searchTerm ? normalizeStrongIdentifier(searchTerm) : null;

  const where: Prisma.CustomerWhereInput = {
    ...(input.type ? { type: input.type } : {}),
    ...(input.status ? { isActive: input.status === "active" } : {}),
    ...(searchTerm
      ? {
          OR: [
            { firstName: { contains: searchTerm, mode: "insensitive" } },
            { lastName: { contains: searchTerm, mode: "insensitive" } },
            { businessName: { contains: searchTerm, mode: "insensitive" } },
            { email: { contains: searchTerm, mode: "insensitive" } },
            { phone: { contains: searchTerm } },
            { code: { contains: searchTerm, mode: "insensitive" } },
            ...(normalizedDigits
              ? [
                  { documentNumberNormalized: { contains: normalizedDigits } } as const,
                  { taxIdNormalized: { contains: normalizedDigits } } as const,
                ]
              : []),
          ],
        }
      : {}),
  };

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: [{ isSystemDefault: "desc" }, { createdAt: "desc" }],
      take,
      skip,
    }),
    prisma.customer.count({ where }),
  ]);

  return { customers, total };
}

// Lookup helper for the "Vincular cuenta" admin action — finds the User to
// link by email (the only identifier an admin realistically has on hand for
// someone else's account) without exposing a general-purpose User search
// from the customers module. Returns null (not a thrown error) for "no such
// account" — the caller decides how to present that.
export async function findLinkableUserByEmail(
  email: string,
): Promise<{ id: string; name: string; email: string } | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, name: true, email: true },
  });
}

// Explicit, admin-only, permission-protected (enforced by the caller — see
// app/(admin)/admin/customers/actions.ts) linking between a Customer and a
// User. Never allows a User already linked to a DIFFERENT Customer to be
// re-linked (would silently steal the link), and never allows a Customer
// that already has a linkedUser to be re-linked without an explicit unlink
// first — no silent overwrite/merge in either direction. An ordinary
// customer can never reach this: it requires customers.manage, which
// CUSTOMER-role accounts never hold (see modules/roles/catalog.ts).
export async function linkCustomerToUser(
  customerId: string,
  userId: string,
  actorId: string,
): Promise<Customer> {
  const [customer, existingLinkForUser] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId } }),
    prisma.customer.findUnique({ where: { linkedUserId: userId } }),
  ]);
  if (!customer) throw new CustomerNotFoundError();
  if (customer.linkedUserId) throw new CustomerAlreadyLinkedError();
  if (existingLinkForUser) throw new UserAlreadyLinkedError();

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: { linkedUserId: userId },
  });

  await recordAuditLog({
    userId: actorId,
    action: "customer.user_linked",
    entityType: "Customer",
    entityId: customerId,
    newValue: { linkedUserId: userId },
  });

  return updated;
}

export async function unlinkCustomerFromUser(customerId: string, actorId: string): Promise<Customer> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new CustomerNotFoundError();

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: { linkedUserId: null },
  });

  await recordAuditLog({
    userId: actorId,
    action: "customer.user_unlinked",
    entityType: "Customer",
    entityId: customerId,
    previousValue: { linkedUserId: customer.linkedUserId },
  });

  return updated;
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

export interface CustomerAddressInput {
  label?: string | null;
  street: string;
  number?: string | null;
  floor?: string | null;
  apartment?: string | null;
  postalCode?: string | null;
  city: string;
  province?: string | null;
  country?: string;
  notes?: string | null;
}

export async function addCustomerAddress(
  customerId: string,
  input: CustomerAddressInput,
  actorId: string,
): Promise<CustomerAddress> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) throw new CustomerNotFoundError();

  // The customer's very first address becomes both defaults automatically
  // — a non-technical admin should never have to take a second action just
  // to make a customer's only address "the" address.
  const existingCount = await prisma.customerAddress.count({ where: { customerId } });

  const address = await prisma.customerAddress.create({
    data: {
      customerId,
      label: input.label || null,
      street: input.street,
      number: input.number || null,
      floor: input.floor || null,
      apartment: input.apartment || null,
      postalCode: input.postalCode || null,
      city: input.city,
      province: input.province || null,
      country: input.country || "AR",
      notes: input.notes || null,
      isDefaultShipping: existingCount === 0,
      isDefaultBilling: existingCount === 0,
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: "customer_address.added",
    entityType: "Customer",
    entityId: customerId,
    newValue: { addressId: address.id, city: address.city },
  });

  return address;
}

export async function updateCustomerAddress(
  addressId: string,
  input: CustomerAddressInput,
  actorId: string,
): Promise<CustomerAddress> {
  const existing = await prisma.customerAddress.findUnique({ where: { id: addressId } });
  if (!existing) throw new AddressNotFoundError();

  const address = await prisma.customerAddress.update({
    where: { id: addressId },
    data: {
      label: input.label || null,
      street: input.street,
      number: input.number || null,
      floor: input.floor || null,
      apartment: input.apartment || null,
      postalCode: input.postalCode || null,
      city: input.city,
      province: input.province || null,
      country: input.country || "AR",
      notes: input.notes || null,
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: "customer_address.updated",
    entityType: "Customer",
    entityId: existing.customerId,
    newValue: { addressId },
  });

  return address;
}

export async function deleteCustomerAddress(addressId: string, actorId: string): Promise<void> {
  const existing = await prisma.customerAddress.findUnique({ where: { id: addressId } });
  if (!existing) throw new AddressNotFoundError();

  await prisma.customerAddress.delete({ where: { id: addressId } });

  await recordAuditLog({
    userId: actorId,
    action: "customer_address.removed",
    entityType: "Customer",
    entityId: existing.customerId,
    previousValue: { addressId, city: existing.city },
  });
}

// Exactly one default shipping address per customer — unset the old one and
// set the new one in a single transaction, same pattern as
// modules/warehouses/service-core.ts's setDefaultWarehouse /
// modules/products/product-images.ts's setPrimaryImage. Belt-and-suspenders
// alongside customer_address_default_shipping_unique (see the migration
// SQL).
export async function setDefaultShippingAddress(
  addressId: string,
  actorId: string,
): Promise<CustomerAddress> {
  const existing = await prisma.customerAddress.findUnique({ where: { id: addressId } });
  if (!existing) throw new AddressNotFoundError();

  const [, updated] = await prisma.$transaction([
    prisma.customerAddress.updateMany({
      where: { customerId: existing.customerId, isDefaultShipping: true },
      data: { isDefaultShipping: false },
    }),
    prisma.customerAddress.update({ where: { id: addressId }, data: { isDefaultShipping: true } }),
  ]);

  await recordAuditLog({
    userId: actorId,
    action: "customer_address.default_shipping_changed",
    entityType: "Customer",
    entityId: existing.customerId,
    newValue: { addressId },
  });

  return updated;
}

export async function setDefaultBillingAddress(
  addressId: string,
  actorId: string,
): Promise<CustomerAddress> {
  const existing = await prisma.customerAddress.findUnique({ where: { id: addressId } });
  if (!existing) throw new AddressNotFoundError();

  const [, updated] = await prisma.$transaction([
    prisma.customerAddress.updateMany({
      where: { customerId: existing.customerId, isDefaultBilling: true },
      data: { isDefaultBilling: false },
    }),
    prisma.customerAddress.update({ where: { id: addressId }, data: { isDefaultBilling: true } }),
  ]);

  await recordAuditLog({
    userId: actorId,
    action: "customer_address.default_billing_changed",
    entityType: "Customer",
    entityId: existing.customerId,
    newValue: { addressId },
  });

  return updated;
}
