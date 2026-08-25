import { describe, expect, it } from "vitest";

import {
  buildLoginTicketRequestXml,
  parseLoginTicketResponseXml,
  WsaaResponseParseError,
} from "@/modules/fiscal-documents/arca/wsaa-tra-core";

describe("buildLoginTicketRequestXml", () => {
  it("produces the fixed WSAA LoginTicketRequest shape with the given header values", () => {
    const xml = buildLoginTicketRequestXml({
      service: "wsfe",
      uniqueId: 123456,
      generationTime: new Date("2026-01-01T10:00:00.000Z"),
      expirationTime: new Date("2026-01-01T10:20:00.000Z"),
    });

    expect(xml).toContain("<loginTicketRequest version=\"1.0\">");
    expect(xml).toContain("<uniqueId>123456</uniqueId>");
    expect(xml).toContain("<generationTime>2026-01-01T10:00:00Z</generationTime>");
    expect(xml).toContain("<expirationTime>2026-01-01T10:20:00Z</expirationTime>");
    expect(xml).toContain("<service>wsfe</service>");
  });
});

describe("parseLoginTicketResponseXml", () => {
  function buildResponseXml(overrides: { token?: string; sign?: string; expirationTime?: string } = {}) {
    const token = overrides.token ?? "TOKEN-VALUE";
    const sign = overrides.sign ?? "SIGN-VALUE";
    const expirationTime = overrides.expirationTime ?? "2026-01-01T22:00:00-03:00";
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<loginTicketResponse version="1.0">` +
      `<header><source>ARCA</source><destination>CUIT</destination><uniqueId>1</uniqueId>` +
      `<generationTime>2026-01-01T10:00:00-03:00</generationTime>` +
      `<expirationTime>${expirationTime}</expirationTime></header>` +
      `<credentials><token>${token}</token><sign>${sign}</sign></credentials>` +
      `</loginTicketResponse>`
    );
  }

  it("extracts token, sign, and expirationTime from a real-shaped response", () => {
    const result = parseLoginTicketResponseXml(buildResponseXml());
    expect(result.token).toBe("TOKEN-VALUE");
    expect(result.sign).toBe("SIGN-VALUE");
    expect(result.expirationTime.toISOString()).toBe(new Date("2026-01-01T22:00:00-03:00").toISOString());
  });

  it("never coerces a numeric-looking token/sign into a number", () => {
    const result = parseLoginTicketResponseXml(buildResponseXml({ token: "123456", sign: "789" }));
    expect(result.token).toBe("123456");
    expect(result.sign).toBe("789");
  });

  it("throws WsaaResponseParseError when the token is missing", () => {
    const xml = buildResponseXml().replace(/<token>.*?<\/token>/, "");
    expect(() => parseLoginTicketResponseXml(xml)).toThrow(WsaaResponseParseError);
  });

  it("throws WsaaResponseParseError when the expiration date is invalid", () => {
    const xml = buildResponseXml({ expirationTime: "not-a-date" });
    expect(() => parseLoginTicketResponseXml(xml)).toThrow(WsaaResponseParseError);
  });

  it("throws WsaaResponseParseError for malformed XML", () => {
    expect(() => parseLoginTicketResponseXml("<not-even-closed")).toThrow(WsaaResponseParseError);
  });
});
