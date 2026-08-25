import { describe, expect, it } from "vitest";

import {
  mercadoPagoAmountToMinorUnits,
  minorUnitsToMercadoPagoAmount,
} from "@/modules/payments/mercado-pago/amount-core";

describe("minorUnitsToMercadoPagoAmount", () => {
  it("converts BigInt minor units to a plain decimal number", () => {
    expect(minorUnitsToMercadoPagoAmount(150050n)).toBe(1500.5);
    expect(minorUnitsToMercadoPagoAmount(100n)).toBe(1);
    expect(minorUnitsToMercadoPagoAmount(0n)).toBe(0);
  });
});

describe("mercadoPagoAmountToMinorUnits", () => {
  it("converts a provider decimal number back to exact BigInt minor units", () => {
    expect(mercadoPagoAmountToMinorUnits(1500.5)).toBe(150050n);
    expect(mercadoPagoAmountToMinorUnits(1)).toBe(100n);
    expect(mercadoPagoAmountToMinorUnits(0)).toBe(0n);
  });

  it("survives the classic IEEE 754 float-imprecision case (1234.56)", () => {
    // 1234.56 * 100 can land on 123455.99999999999 in raw floating point —
    // Math.round must correct this, never silently truncate to 123455n.
    expect(mercadoPagoAmountToMinorUnits(1234.56)).toBe(123456n);
  });

  it("round-trips through both directions without drift", () => {
    const original = 987654321n;
    const asProviderAmount = minorUnitsToMercadoPagoAmount(original);
    expect(mercadoPagoAmountToMinorUnits(asProviderAmount)).toBe(original);
  });
});
