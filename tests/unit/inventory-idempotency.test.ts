import { describe, expect, it } from "vitest";

import {
  buildImportIdempotencyKey,
  generateClientIdempotencyKey,
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
