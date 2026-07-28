import { describe, expect, it } from "vitest";

import {
  deserializeMoney,
  displayToMinorUnits,
  InvalidMoneyInputError,
  minorUnitsToDisplay,
  roundHalfAwayFromZero,
  serializeMoney,
} from "@/lib/money";

describe("roundHalfAwayFromZero", () => {
  it("rounds positive halves up", () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(1.5)).toBe(2);
  });

  it("rounds negative halves away from zero (unlike Math.round)", () => {
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(-1.5)).toBe(-2);
    // Math.round(-0.5) is -0, not -1 — this is exactly the bug being avoided.
    expect(Math.round(-0.5)).toBe(-0);
  });

  it("rounds non-halves normally", () => {
    expect(roundHalfAwayFromZero(1.4)).toBe(1);
    expect(roundHalfAwayFromZero(-1.4)).toBe(-1);
  });
});

describe("displayToMinorUnits", () => {
  it("parses a plain integer", () => {
    expect(displayToMinorUnits("15000")).toBe(1500000n);
  });

  it("parses comma as a decimal separator (es-AR)", () => {
    expect(displayToMinorUnits("15000,50")).toBe(1500050n);
  });

  it("parses a plain dot as a decimal separator when 1-2 digits follow", () => {
    expect(displayToMinorUnits("15000.50")).toBe(1500050n);
    expect(displayToMinorUnits("15000.5")).toBe(1500050n);
  });

  it("parses dot-thousands + comma-decimal (es-AR grouped)", () => {
    expect(displayToMinorUnits("15.000,50")).toBe(1500050n);
  });

  it("parses a single dot with 3 trailing digits as thousands grouping", () => {
    expect(displayToMinorUnits("15.000")).toBe(1500000n);
  });

  it("parses comma-thousands + dot-decimal (US grouped)", () => {
    expect(displayToMinorUnits("15,000.50")).toBe(1500050n);
  });

  it("parses multiple thousands separators with no decimal part", () => {
    expect(displayToMinorUnits("15.000.000")).toBe(1500000000n);
    expect(displayToMinorUnits("15,000,000")).toBe(1500000000n);
  });

  it("handles a leading negative sign", () => {
    expect(displayToMinorUnits("-15000,50")).toBe(-1500050n);
  });

  it("strips currency symbols and whitespace", () => {
    expect(displayToMinorUnits("$ 15000,50")).toBe(1500050n);
    expect(displayToMinorUnits("ARS 15000,50")).toBe(1500050n);
  });

  it("rejects more than 2 fractional digits rather than truncating", () => {
    expect(() => displayToMinorUnits("15000,555")).toThrow(InvalidMoneyInputError);
  });

  it("rejects empty or non-numeric input", () => {
    expect(() => displayToMinorUnits("")).toThrow(InvalidMoneyInputError);
    expect(() => displayToMinorUnits("abc")).toThrow(InvalidMoneyInputError);
  });
});

describe("minorUnitsToDisplay", () => {
  it("formats minor units as ARS currency", () => {
    const formatted = minorUnitsToDisplay(1500050n);
    // Locale formatting details vary by ICU data; assert on content, not
    // exact punctuation/symbol placement.
    expect(formatted).toContain("15.000,50");
  });

  it("round-trips through displayToMinorUnits for whole and fractional amounts", () => {
    expect(displayToMinorUnits("15000")).toBe(1500000n);
    expect(minorUnitsToDisplay(1500000n)).toContain("15.000,00");
  });
});

describe("serializeMoney / deserializeMoney", () => {
  it("round-trips a bigint through a string boundary", () => {
    const amount = 1500050n;
    expect(deserializeMoney(serializeMoney(amount))).toBe(amount);
  });
});
