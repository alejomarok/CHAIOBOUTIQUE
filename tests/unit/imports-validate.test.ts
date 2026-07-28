import { describe, expect, it } from "vitest";

import { validateImportRows } from "@/modules/imports/validate";

describe("validateImportRows — CATEGORIES", () => {
  it("accepts a well-formed row", () => {
    const { validRows, issues } = validateImportRows("CATEGORIES", [
      { legacyId: "CAT-1", name: "Remeras", parentLegacyId: "", description: "", displayOrder: "3" },
    ]);
    expect(issues).toHaveLength(0);
    expect(validRows).toHaveLength(1);
    expect(validRows[0].data).toMatchObject({ legacyId: "CAT-1", name: "Remeras", displayOrder: 3 });
    // Row 1 is the header; the first data row is row 2.
    expect(validRows[0].rowNumber).toBe(2);
  });

  it("rejects a row missing the required legacyId", () => {
    const { validRows, issues } = validateImportRows("CATEGORIES", [
      { legacyId: "", name: "Remeras" },
    ]);
    expect(validRows).toHaveLength(0);
    expect(issues).toHaveLength(1);
    expect(issues[0].errorCode).toBe("VALIDATION");
  });

  it("flags a duplicate legacyId within the same file", () => {
    const { validRows, issues } = validateImportRows("CATEGORIES", [
      { legacyId: "CAT-1", name: "Remeras" },
      { legacyId: "CAT-1", name: "Remeras (otra vez)" },
    ]);
    expect(validRows).toHaveLength(1);
    expect(issues).toHaveLength(1);
    expect(issues[0].errorCode).toBe("DUPLICATE_IN_FILE");
    expect(issues[0].rowNumber).toBe(3);
  });
});

describe("validateImportRows — PRODUCTS money fields", () => {
  it("parses a valid es-AR formatted price into minor units", () => {
    const { validRows, issues } = validateImportRows("PRODUCTS", [
      { legacyId: "P-1", name: "Remera", defaultPriceAmount: "15.000,50" },
    ]);
    expect(issues).toHaveLength(0);
    expect((validRows[0].data as { defaultPriceAmount: bigint | null }).defaultPriceAmount).toBe(
      1500050n,
    );
  });

  it("rejects an unparseable price", () => {
    const { validRows, issues } = validateImportRows("PRODUCTS", [
      { legacyId: "P-1", name: "Remera", defaultPriceAmount: "not-a-number" },
    ]);
    expect(validRows).toHaveLength(0);
    expect(issues[0].errorCode).toBe("VALIDATION");
  });

  it("treats an empty price cell as null, not an error", () => {
    const { validRows, issues } = validateImportRows("PRODUCTS", [
      { legacyId: "P-1", name: "Remera", defaultPriceAmount: "" },
    ]);
    expect(issues).toHaveLength(0);
    expect((validRows[0].data as { defaultPriceAmount: bigint | null }).defaultPriceAmount).toBeNull();
  });
});

describe("validateImportRows — INITIAL_STOCK", () => {
  it("rejects a negative quantity", () => {
    const { issues } = validateImportRows("INITIAL_STOCK", [
      { sku: "SKU-1", warehouseCode: "MAIN", quantity: "-5" },
    ]);
    expect(issues[0].errorCode).toBe("VALIDATION");
  });

  it("flags a duplicate sku+warehouse combination within the file", () => {
    const { validRows, issues } = validateImportRows("INITIAL_STOCK", [
      { sku: "SKU-1", warehouseCode: "MAIN", quantity: "5" },
      { sku: "SKU-1", warehouseCode: "MAIN", quantity: "7" },
    ]);
    expect(validRows).toHaveLength(1);
    expect(issues[0].errorCode).toBe("DUPLICATE_IN_FILE");
  });

  it("allows the same sku across two different warehouses", () => {
    const { validRows, issues } = validateImportRows("INITIAL_STOCK", [
      { sku: "SKU-1", warehouseCode: "MAIN", quantity: "5" },
      { sku: "SKU-1", warehouseCode: "ANNEX", quantity: "7" },
    ]);
    expect(issues).toHaveLength(0);
    expect(validRows).toHaveLength(2);
  });
});
