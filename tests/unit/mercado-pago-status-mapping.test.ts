import { describe, expect, it } from "vitest";

import { mapMercadoPagoPaymentStatus } from "@/modules/payments/mercado-pago/status-mapping-core";

describe("mapMercadoPagoPaymentStatus", () => {
  it("maps approved to APPROVED", () => {
    expect(mapMercadoPagoPaymentStatus("approved")).toBe("APPROVED");
  });

  it("maps pending and in_process to PENDING", () => {
    expect(mapMercadoPagoPaymentStatus("pending")).toBe("PENDING");
    expect(mapMercadoPagoPaymentStatus("in_process")).toBe("PENDING");
  });

  it("maps rejected to REJECTED", () => {
    expect(mapMercadoPagoPaymentStatus("rejected")).toBe("REJECTED");
  });

  it("maps cancelled to CANCELLED", () => {
    expect(mapMercadoPagoPaymentStatus("cancelled")).toBe("CANCELLED");
  });

  it("maps refunded and charged_back to REFUNDED", () => {
    expect(mapMercadoPagoPaymentStatus("refunded")).toBe("REFUNDED");
    expect(mapMercadoPagoPaymentStatus("charged_back")).toBe("REFUNDED");
  });

  it("never guesses on an unrecognized status — returns null", () => {
    expect(mapMercadoPagoPaymentStatus("some_future_status")).toBeNull();
    expect(mapMercadoPagoPaymentStatus("")).toBeNull();
  });
});
