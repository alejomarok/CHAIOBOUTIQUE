import { describe, expect, it } from "vitest";

import {
  getCustomerDisplayName,
  normalizeEmail,
  normalizePhone,
  normalizeStrongIdentifier,
} from "@/modules/customers/normalize";

describe("normalizeStrongIdentifier", () => {
  it("strips dots, dashes and spaces down to digits only", () => {
    expect(normalizeStrongIdentifier("30.123.456")).toBe("30123456");
    expect(normalizeStrongIdentifier("20-12345678-9")).toBe("20123456789");
    expect(normalizeStrongIdentifier("30 123 456")).toBe("30123456");
  });

  it("treats every formatting variant of the same number as identical", () => {
    const a = normalizeStrongIdentifier("30.123.456");
    const b = normalizeStrongIdentifier("30123456");
    const c = normalizeStrongIdentifier("30-123-456");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("returns null for empty/whitespace-only/non-digit input", () => {
    expect(normalizeStrongIdentifier(null)).toBeNull();
    expect(normalizeStrongIdentifier(undefined)).toBeNull();
    expect(normalizeStrongIdentifier("")).toBeNull();
    expect(normalizeStrongIdentifier("---")).toBeNull();
  });
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Juan.Perez@Email.COM  ")).toBe("juan.perez@email.com");
  });

  it("returns null for empty input", () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail("")).toBeNull();
    expect(normalizeEmail("   ")).toBe(null);
  });
});

describe("normalizePhone", () => {
  it("strips punctuation/spaces, keeping only digits", () => {
    expect(normalizePhone("11 5555-5555")).toBe("1155555555");
    expect(normalizePhone("(011) 5555-5555")).toBe("01155555555");
  });

  it("preserves a single leading + for international format", () => {
    expect(normalizePhone("+54 9 11 5555-5555")).toBe("+5491155555555");
  });

  it("returns null for empty/non-digit input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("---")).toBeNull();
  });
});

describe("getCustomerDisplayName", () => {
  it("joins firstName + lastName for a PERSON", () => {
    expect(getCustomerDisplayName({ type: "PERSON", firstName: "Juan", lastName: "Pérez" })).toBe(
      "Juan Pérez",
    );
  });

  it("uses only firstName when lastName is missing", () => {
    expect(getCustomerDisplayName({ type: "PERSON", firstName: "Juan", lastName: null })).toBe(
      "Juan",
    );
  });

  it("falls back to a placeholder for a nameless PERSON", () => {
    expect(getCustomerDisplayName({ type: "PERSON", firstName: null, lastName: null })).toBe(
      "Cliente sin nombre",
    );
  });

  it("uses businessName for a COMPANY, ignoring firstName/lastName", () => {
    expect(
      getCustomerDisplayName({
        type: "COMPANY",
        businessName: "Acme SRL",
        firstName: "Juan",
        lastName: "Pérez",
      }),
    ).toBe("Acme SRL");
  });

  it("falls back to a placeholder for a nameless COMPANY", () => {
    expect(getCustomerDisplayName({ type: "COMPANY", businessName: null })).toBe(
      "Empresa sin nombre",
    );
  });
});
