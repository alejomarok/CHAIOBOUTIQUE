import { describe, expect, it } from "vitest";

import { computeProductListStatus } from "@/modules/products/list-status";

const baseProduct = { status: "ACTIVE", categoryId: "cat-1", defaultPriceAmount: 1000n };
const activeVariant = { isActive: true, priceAmount: null };

describe("computeProductListStatus", () => {
  it("is PUBLISHED for an active, publicly visible product with stock", () => {
    const result = computeProductListStatus(baseProduct, [activeVariant], 5);
    expect(result.status).toBe("PUBLISHED");
    expect(result.label).toBe("Publicado");
  });

  it("is OUT_OF_STOCK for an active, publicly visible product with zero stock — still visible, never a blocker", () => {
    const result = computeProductListStatus(baseProduct, [activeVariant], 0);
    expect(result.status).toBe("OUT_OF_STOCK");
    expect(result.label).toBe("Sin stock");
  });

  it("is READY_TO_PUBLISH for a DRAFT product with everything else complete", () => {
    const result = computeProductListStatus({ ...baseProduct, status: "DRAFT" }, [activeVariant], 0);
    expect(result.status).toBe("READY_TO_PUBLISH");
    expect(result.label).toBe("Listo para publicar");
  });

  it("is DRAFT_INCOMPLETE for a DRAFT product missing a category", () => {
    const result = computeProductListStatus(
      { ...baseProduct, status: "DRAFT", categoryId: null },
      [activeVariant],
      0,
    );
    expect(result.status).toBe("DRAFT_INCOMPLETE");
    expect(result.label).toBe("Borrador — faltan datos");
  });

  it("is DRAFT_INCOMPLETE for a DRAFT product with no active variants", () => {
    const result = computeProductListStatus({ ...baseProduct, status: "DRAFT" }, [], 0);
    expect(result.status).toBe("DRAFT_INCOMPLETE");
  });

  it("is BLOCKED for a previously-published ACTIVE product that lost its only active variant", () => {
    const result = computeProductListStatus(baseProduct, [], 0);
    expect(result.status).toBe("BLOCKED");
    expect(result.label).toBe("Bloqueado");
  });

  it("is BLOCKED for an ACTIVE product whose active variant lost its valid price", () => {
    const result = computeProductListStatus(
      { ...baseProduct, defaultPriceAmount: null },
      [activeVariant],
      3,
    );
    expect(result.status).toBe("BLOCKED");
  });

  it("is READY_TO_PUBLISH, not BLOCKED, for an INACTIVE (previously published) product that is otherwise complete", () => {
    const result = computeProductListStatus({ ...baseProduct, status: "INACTIVE" }, [activeVariant], 0);
    expect(result.status).toBe("READY_TO_PUBLISH");
  });
});
