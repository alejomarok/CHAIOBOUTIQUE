import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import {
  buildImportIdempotencyKey,
  generateClientIdempotencyKey,
  isIdempotencyKeyConflict,
} from "@/modules/inventory/idempotency";

describe("generateClientIdempotencyKey", () => {
  it("generates a unique key each call", () => {
    const a = generateClientIdempotencyKey();
    const b = generateClientIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("buildImportIdempotencyKey", () => {
  it("is deterministic for the same source row", () => {
    const key1 = buildImportIdempotencyKey({
      operationType: "initial_stock",
      sourceSystem: "legacy_erp",
      legacyId: "ROW-123",
    });
    const key2 = buildImportIdempotencyKey({
      operationType: "initial_stock",
      sourceSystem: "legacy_erp",
      legacyId: "ROW-123",
    });
    expect(key1).toBe(key2);
  });

  it("is scoped by sourceSystem + legacyId, not by import batch", () => {
    // Deliberately no batch id in the signature — re-uploading the same
    // source row in a different batch must hit the same key.
    const key = buildImportIdempotencyKey({
      operationType: "initial_stock",
      sourceSystem: "legacy_erp",
      legacyId: "ROW-123",
    });
    expect(key).toBe("import:initial_stock:legacy_erp:ROW-123");
  });

  it("differs for different source rows", () => {
    const key1 = buildImportIdempotencyKey({
      operationType: "initial_stock",
      sourceSystem: "legacy_erp",
      legacyId: "ROW-123",
    });
    const key2 = buildImportIdempotencyKey({
      operationType: "initial_stock",
      sourceSystem: "legacy_erp",
      legacyId: "ROW-124",
    });
    expect(key1).not.toBe(key2);
  });
});

// A real Error subclass, mirroring @prisma/adapter-pg's actual
// driverAdapterError shape observed directly from this codebase's own
// adapter (a connection failure logged as `driverAdapterError:
// DriverAdapterError: TlsConnectionError ... cause: [Object]`): a named
// Error instance wrapping the underlying node-postgres error via the
// standard `cause` option, not a plain data object.
class FakeDriverAdapterError extends Error {
  constructor(cause: unknown) {
    super("UniqueConstraintViolation", { cause });
    this.name = "DriverAdapterError";
  }
}

function buildP2002(meta: Record<string, unknown>, message = "Unique constraint failed") {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: "P2002",
    clientVersion: "7.9.0",
    meta,
  });
}

describe("isIdempotencyKeyConflict", () => {
  it("detects the classic query-engine shape (meta.target as an array)", () => {
    const error = buildP2002({ target: ["idempotencyKey"] });
    expect(isIdempotencyKeyConflict(error)).toBe(true);
  });

  it("detects a bare-string target shape", () => {
    const error = buildP2002({ target: "idempotencyKey" });
    expect(isIdempotencyKeyConflict(error)).toBe(true);
  });

  it("detects the Prisma 7 + @prisma/adapter-pg shape, where meta has no target at all", () => {
    // Postgres's own unique_violation message is where the constraint name
    // actually lives in this shape — not in any structured field.
    const pgError = new Error(
      'duplicate key value violates unique constraint "inventory_operation_idempotencyKey_key"',
    );
    const error = buildP2002({
      modelName: "InventoryOperation",
      driverAdapterError: new FakeDriverAdapterError(pgError),
    });
    expect(isIdempotencyKeyConflict(error)).toBe(true);
  });

  it("detects the constraint name even via Prisma's own top-level message", () => {
    const error = buildP2002(
      {},
      'Unique constraint failed on the constraint: `inventory_operation_idempotencyKey_key`',
    );
    expect(isIdempotencyKeyConflict(error)).toBe(true);
  });

  it("does not misreport an unrelated unique violation (classic shape)", () => {
    const error = buildP2002({ target: ["sku"] });
    expect(isIdempotencyKeyConflict(error)).toBe(false);
  });

  it("does not misreport an unrelated unique violation (adapter-pg shape)", () => {
    const pgError = new Error(
      'duplicate key value violates unique constraint "product_variant_sku_key"',
    );
    const error = buildP2002({ driverAdapterError: new FakeDriverAdapterError(pgError) });
    expect(isIdempotencyKeyConflict(error)).toBe(false);
  });

  it("returns false for a non-P2002 Prisma error", () => {
    const error = new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: "7.9.0",
    });
    expect(isIdempotencyKeyConflict(error)).toBe(false);
  });

  it("returns false for a non-Prisma error entirely", () => {
    expect(isIdempotencyKeyConflict(new Error("some other failure"))).toBe(false);
    expect(isIdempotencyKeyConflict("not even an error")).toBe(false);
    expect(isIdempotencyKeyConflict(null)).toBe(false);
  });
});
