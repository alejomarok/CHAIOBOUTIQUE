// Idempotency-key generation strategy per source. InventoryOperation.idempotencyKey
// is the real duplicate-prevention mechanism (a dedicated nullable unique
// column) — correlationId is grouping-for-observability only, never used
// for dedup. See docs/adr/0002-inventory-balance-projection.md.
//
// Deliberately no "@/lib/db"/"@/lib/env" import anywhere in this file, even
// though isIdempotencyKeyConflict below is only ever called from
// modules/inventory/service.ts (which does depend on them): this keeps the
// file importable from a plain unit test with no database/env setup at all
// — @/generated/prisma/client's error classes are pure type/class
// definitions with no side effects, unlike constructing an actual
// PrismaClient.

import { Prisma } from "@/generated/prisma/client";

// Manual adjustments and transfers: the caller (an admin form) generates a
// UUID once when it mounts and resubmits the same value on every attempt —
// a double-click or network retry reuses the same key and is rejected as a
// duplicate rather than double-applied. There's nothing to compute
// server-side; the client-supplied UUID *is* the key. This helper exists so
// call sites don't hand-roll the crypto.randomUUID() call inline.
export function generateClientIdempotencyKey(): string {
  return crypto.randomUUID();
}

// Imports: deterministic and derived from the source row's business
// identity, NOT the import batch — this is what makes re-uploading the same
// source file (or a corrected re-export containing the same row) safely
// idempotent regardless of which batch it came from. Scoped by
// (sourceSystem, legacyId), not importBatchId.
export function buildImportIdempotencyKey(input: {
  operationType: "initial_stock" | "adjustment";
  sourceSystem: string;
  legacyId: string;
}): string {
  return `import:${input.operationType}:${input.sourceSystem}:${input.legacyId}`;
}

// Future webhooks (documented for later phases, not implemented now): use
// the provider's own delivery/event id as the key, e.g.:
//   `webhook:mercadopago:${event.id}`

// The unique constraint backing InventoryOperation.idempotencyKey, exactly
// as named in the applied migration (`CREATE UNIQUE INDEX
// "inventory_operation_idempotencyKey_key" ON "inventory_operation"
// ("idempotencyKey")`) — verified against migration.sql, not assumed.
const IDEMPOTENCY_KEY_CONSTRAINT_NAME = "inventory_operation_idempotencyKey_key";

// Error/unknown -> its message text, without throwing and without relying
// on JSON.stringify (which silently drops an Error's own message/name,
// since those aren't enumerable own properties — would make this check
// blind to exactly the shape it needs to see). String-coercing an Error
// calls its own toString(), which always includes `name: message` even for
// a driver-specific subclass we've never seen the shape of before.
function describeUnknown(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Error) {
    const causeText = "cause" in value ? describeUnknown(value.cause) : "";
    return `${value.toString()} ${causeText}`;
  }
  if (typeof value === "string") return value;
  return String(value);
}

// P2002 ("Unique constraint failed") is the one part of this check that's
// stable across Prisma versions/engines — always gate on it first. Which
// column/constraint actually violated is where the shape isn't stable: the
// classic query-engine shape is a flat `meta.target: string[]`, but Prisma 7
// with @prisma/adapter-pg doesn't always populate that — it can surface the
// underlying driver error instead, via `meta.driverAdapterError`, a real
// Error instance (confirmed directly: a connection failure from this same
// adapter logged as `driverAdapterError: DriverAdapterError: TlsConnectionError
// ... cause: [Object]`) wrapping node-postgres's own error, whose `.message`
// is where Postgres's unique_violation detail — including the constraint
// name — actually lives. Rather than assume one exact shape again (that's
// what broke this check the first time), this looks for the column/
// constraint name in every string this error carries: the classic `target`
// (array or, in some adapters, a bare string), Prisma's own top-level
// `.message`, and the driverAdapterError chain (including its `.cause`).
// Scoped specifically to this column/constraint name, never "any P2002" —
// an unrelated unique violation (e.g. a duplicate SKU surfacing through
// this same code path some other way) must never be misreported as a
// duplicate operation.
export function isIdempotencyKeyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;

  const target = error.meta?.target;
  if (Array.isArray(target) && target.includes("idempotencyKey")) return true;
  if (typeof target === "string" && target.includes("idempotencyKey")) return true;

  const haystack = [describeUnknown(error.message), describeUnknown(error.meta?.driverAdapterError)]
    .join(" ")
    .toLowerCase();

  return (
    haystack.includes("idempotencykey") ||
    haystack.includes(IDEMPOTENCY_KEY_CONSTRAINT_NAME.toLowerCase())
  );
}
