// Pure — no "server-only", no DB import, no network, no fs, no signing.
// Builds/parses the two small, fixed-shape XML documents WSAA's protocol
// uses (LoginTicketRequest / LoginTicketResponse) — kept strictly separate
// from wsaa-core.ts's signing/network responsibilities so this half stays
// trivially unit-testable with plain strings, same "-core" pure/network
// split convention as wsfe-request-builder-core.ts vs.
// electronic-invoice-provider-core.ts.
import { XMLParser } from "fast-xml-parser";

export class WsaaFaultError extends Error {
  constructor(faultString: string) {
    super(`ARCA (WSAA) rechazó la solicitud: ${faultString}`);
    this.name = "WsaaFaultError";
  }
}

export class WsaaResponseParseError extends Error {
  constructor(reason: string) {
    super(`No se pudo interpretar la respuesta de ARCA (WSAA): ${reason}.`);
    this.name = "WsaaResponseParseError";
  }
}

// ISO-8601 with an explicit "Z" (UTC) offset, seconds precision (no
// milliseconds) — a format WSAA's own examples and every third-party
// implementation surveyed for this phase accept. What matters to WSAA is
// only that this represents the correct UTC instant, not which offset
// notation is used.
function formatWsaaTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface LoginTicketRequestInput {
  service: string;
  uniqueId: number;
  generationTime: Date;
  expirationTime: Date;
}

// Field order matches WSAA's own published schema
// (loginTicketRequest > header > {uniqueId, generationTime, expirationTime},
// then a sibling <service>) — hand-built rather than via a general XML
// builder since this is one small, entirely fixed shape, never varying by
// input beyond these four values.
export function buildLoginTicketRequestXml(input: LoginTicketRequestInput): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0">` +
    `<header>` +
    `<uniqueId>${input.uniqueId}</uniqueId>` +
    `<generationTime>${formatWsaaTimestamp(input.generationTime)}</generationTime>` +
    `<expirationTime>${formatWsaaTimestamp(input.expirationTime)}</expirationTime>` +
    `</header>` +
    `<service>${input.service}</service>` +
    `</loginTicketRequest>`
  );
}

export interface LoginTicketResponse {
  token: string;
  sign: string;
  expirationTime: Date;
}

// Parses the LoginTicketResponse XML (the CMS-signed response body WSAA
// returns, already unwrapped from its outer SOAP envelope by the caller —
// see wsaa-core.ts's callWsaaLoginCms). parseTagValue: false keeps every
// leaf as a raw string — token/sign must never be coerced by a "looks
// numeric" heuristic.
export function parseLoginTicketResponseXml(xml: string): LoginTicketResponse {
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, removeNSPrefix: true });
  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (error) {
    throw new WsaaResponseParseError(error instanceof Error ? error.message : "XML inválido");
  }

  const root = (parsed as Record<string, unknown>)?.loginTicketResponse as Record<string, unknown> | undefined;
  const credentials = root?.credentials as Record<string, unknown> | undefined;
  const header = root?.header as Record<string, unknown> | undefined;

  const token = credentials?.token;
  const sign = credentials?.sign;
  const expirationTimeRaw = header?.expirationTime;

  if (typeof token !== "string" || !token) {
    throw new WsaaResponseParseError("falta el token en la respuesta");
  }
  if (typeof sign !== "string" || !sign) {
    throw new WsaaResponseParseError("falta el sign en la respuesta");
  }
  if (typeof expirationTimeRaw !== "string" || !expirationTimeRaw) {
    throw new WsaaResponseParseError("falta la fecha de expiración en la respuesta");
  }

  const expirationTime = new Date(expirationTimeRaw);
  if (Number.isNaN(expirationTime.getTime())) {
    throw new WsaaResponseParseError("la fecha de expiración no es válida");
  }

  return { token, sign, expirationTime };
}
