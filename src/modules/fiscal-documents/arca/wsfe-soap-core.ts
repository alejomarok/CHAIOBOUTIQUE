// Node-safe core: no "server-only" import. Real WSFEv1 SOAP layer — hand-
// built envelopes for the fixed, small set of methods this integration
// actually needs (FEDummy, FECompUltimoAutorizado, FECAESolicitar,
// FECompConsultar, FEParamGetTiposIva), same "deterministic, small, fixed
// set of hand-built SOAP envelopes" dependency justification as
// wsaa-core.ts's own callWsaaLoginCms — a general WSDL-driven `soap`
// package buys nothing for a handful of always-the-same-shape calls.
//
// Field names/order inside each request mirror WSFEv1's own published
// FECAESolicitar/FECompConsultar schemas verbatim — see
// wsfe-request-builder-core.ts's own "field names deliberately match
// WSFEv1's own request shape" precedent, reused here rather than
// reinvented (this phase's explicit "reuse the existing pure request
// builder" instruction for WsfeInvoiceRequest).
import { XMLParser } from "fast-xml-parser";

import type { ArcaAuthTicket } from "./auth-provider-core";
import type { WsfeInvoiceRequest } from "./wsfe-request-builder-core";

export class WsfeNetworkError extends Error {
  constructor(cause: string) {
    super(`No se pudo contactar al servicio WSFEv1 de ARCA: ${cause}.`);
    this.name = "WsfeNetworkError";
  }
}

export class WsfeFaultError extends Error {
  constructor(faultString: string) {
    super(`ARCA (WSFEv1) rechazó la solicitud: ${faultString}`);
    this.name = "WsfeFaultError";
  }
}

export class WsfeResponseParseError extends Error {
  constructor(reason: string) {
    super(`No se pudo interpretar la respuesta de ARCA (WSFEv1): ${reason}.`);
    this.name = "WsfeResponseParseError";
  }
}

const WSFE_SOAP_NAMESPACE = "http://ar.gov.afip.dif.FEV1/";

function authXml(auth: ArcaAuthTicket, cuit: string): string {
  return `<ar:Auth><ar:Token>${auth.token}</ar:Token><ar:Sign>${auth.sign}</ar:Sign><ar:Cuit>${sanitizeCuit(cuit)}</ar:Cuit></ar:Auth>`;
}

// CUIT arrives from StoreConfiguration.fiscalTaxId, a free-text field that
// may contain hyphens for display ("20-12345678-9") — WSFEv1 expects an
// 11-digit number with no separators.
function sanitizeCuit(cuit: string): string {
  return cuit.replace(/\D/g, "");
}

// Amounts on WsfeInvoiceRequest are already the deliberate Number boundary
// conversion (see wsfe-request-builder-core.ts's own comment) — toFixed(2)
// here is a formatting step only (never a rounding decision: the source
// value already carries at most 2 fractional digits, having been derived
// from integer minor units).
function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

async function soapPost(wsfeUrl: string, method: string, bodyXml: string): Promise<Record<string, unknown>> {
  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${WSFE_SOAP_NAMESPACE}">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>${bodyXml}</soapenv:Body>` +
    `</soapenv:Envelope>`;

  let responseText: string;
  try {
    const response = await fetch(wsfeUrl, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `${WSFE_SOAP_NAMESPACE}${method}` },
      body: envelope,
    });
    responseText = await response.text();
    if (!response.ok && !responseText.includes("Fault")) {
      throw new WsfeNetworkError(`HTTP ${response.status}`);
    }
  } catch (error) {
    if (error instanceof WsfeNetworkError) throw error;
    throw new WsfeNetworkError(error instanceof Error ? error.message : "error de red desconocido");
  }

  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, removeNSPrefix: true });
  let parsed: unknown;
  try {
    parsed = parser.parse(responseText);
  } catch (error) {
    throw new WsfeResponseParseError(error instanceof Error ? error.message : "sobre SOAP inválido");
  }

  const envelopeNode = (parsed as Record<string, unknown>)?.Envelope as Record<string, unknown> | undefined;
  const body = envelopeNode?.Body as Record<string, unknown> | undefined;
  if (!body) throw new WsfeResponseParseError("el sobre SOAP no tiene Body");

  const fault = body.Fault as Record<string, unknown> | undefined;
  if (fault) {
    const faultString = typeof fault.faultstring === "string" ? fault.faultstring : "error desconocido";
    throw new WsfeFaultError(faultString);
  }

  return body;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

interface RawObs {
  Code?: unknown;
  Msg?: unknown;
}

export interface WsfeObservation {
  code: string;
  message: string;
}

function mapObservations(raw: RawObs | RawObs[] | undefined): WsfeObservation[] {
  return toArray(raw).map((entry) => ({
    code: String(entry.Code ?? ""),
    message: String(entry.Msg ?? ""),
  }));
}

// Parses a fixed-length numeric string like "20250115" (yyyymmdd, WSFEv1's
// own date convention — see wsfe-request-builder-core.ts's formatArcaDate)
// back into a Date. Never used for anything but display/persistence — this
// integration's own outbound dates are still built by that same formatter.
function parseArcaDate(value: string): Date | null {
  if (!/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

// =============================================================================
// FEDummy — health check, no Auth required.
// =============================================================================

export interface WsfeDummyResult {
  appServer: string;
  dbServer: string;
  authServer: string;
}

export async function callFeDummy(wsfeUrl: string): Promise<WsfeDummyResult> {
  const body = await soapPost(wsfeUrl, "FEDummy", `<ar:FEDummy/>`);
  const result = (body.FEDummyResponse as Record<string, unknown> | undefined)?.FEDummyResult as
    | Record<string, unknown>
    | undefined;
  if (!result) throw new WsfeResponseParseError("falta FEDummyResult");
  return {
    appServer: String(result.AppServer ?? ""),
    dbServer: String(result.DbServer ?? ""),
    authServer: String(result.AuthServer ?? ""),
  };
}

// =============================================================================
// FECompUltimoAutorizado — the correlative-numbering authority.
// =============================================================================

export interface WsfeLastVoucherInput {
  pointOfSale: number;
  documentTypeCode: number;
}

export async function callFeCompUltimoAutorizado(
  wsfeUrl: string,
  auth: ArcaAuthTicket,
  cuit: string,
  input: WsfeLastVoucherInput,
): Promise<number> {
  const bodyXml =
    `<ar:FECompUltimoAutorizado>` +
    authXml(auth, cuit) +
    `<ar:PtoVta>${input.pointOfSale}</ar:PtoVta>` +
    `<ar:CbteTipo>${input.documentTypeCode}</ar:CbteTipo>` +
    `</ar:FECompUltimoAutorizado>`;

  const body = await soapPost(wsfeUrl, "FECompUltimoAutorizado", bodyXml);
  const result = (body.FECompUltimoAutorizadoResponse as Record<string, unknown> | undefined)
    ?.FECompUltimoAutorizadoResult as Record<string, unknown> | undefined;
  if (!result) throw new WsfeResponseParseError("falta FECompUltimoAutorizadoResult");

  const errors = mapObservations((result.Errors as Record<string, unknown> | undefined)?.Err as RawObs | RawObs[] | undefined);
  if (errors.length > 0) {
    throw new WsfeFaultError(errors.map((e) => `[${e.code}] ${e.message}`).join("; "));
  }

  const cbteNro = Number(result.CbteNro ?? Number.NaN);
  if (!Number.isFinite(cbteNro)) throw new WsfeResponseParseError("CbteNro no es un número válido");
  return cbteNro;
}

// =============================================================================
// FECAESolicitar — CAE request. Never throws on a legitimate REJECTED
// outcome (Resultado "R") — see this phase's explicit "deliberate handling
// of APPROVED/REJECTED... persisting only real ARCA-returned fields, never
// fabricating" requirement; the caller (issue-electronic-invoice-core.ts)
// decides what a rejection means for the FiscalDocument's own status. Only
// a genuine SOAP Fault, network failure, or malformed response throws.
// =============================================================================

export type WsfeCaeResult =
  | {
      outcome: "APPROVED";
      cae: string;
      caeExpiresAt: Date;
      voucherNumber: number;
      observations: WsfeObservation[];
      events: WsfeObservation[];
    }
  | {
      outcome: "REJECTED";
      voucherNumber: number;
      observations: WsfeObservation[];
      errors: WsfeObservation[];
      events: WsfeObservation[];
    };

function buildFeCaeDetReqXml(request: WsfeInvoiceRequest): string {
  const ivaXml = request.Iva.map(
    (entry) =>
      `<ar:AlicIva><ar:Id>${entry.Id}</ar:Id><ar:BaseImp>${formatAmount(entry.BaseImp)}</ar:BaseImp><ar:Importe>${formatAmount(entry.Importe)}</ar:Importe></ar:AlicIva>`,
  ).join("");

  return (
    `<ar:FECAEDetRequest>` +
    `<ar:Concepto>${request.Concepto}</ar:Concepto>` +
    `<ar:DocTipo>${request.DocTipo}</ar:DocTipo>` +
    `<ar:DocNro>${request.DocNro}</ar:DocNro>` +
    `<ar:CbteDesde>${request.CbteDesde}</ar:CbteDesde>` +
    `<ar:CbteHasta>${request.CbteHasta}</ar:CbteHasta>` +
    `<ar:CbteFch>${request.CbteFch}</ar:CbteFch>` +
    `<ar:ImpTotal>${formatAmount(request.ImpTotal)}</ar:ImpTotal>` +
    `<ar:ImpTotConc>${formatAmount(request.ImpTotConc)}</ar:ImpTotConc>` +
    `<ar:ImpNeto>${formatAmount(request.ImpNeto)}</ar:ImpNeto>` +
    `<ar:ImpOpEx>${formatAmount(request.ImpOpEx)}</ar:ImpOpEx>` +
    `<ar:ImpTrib>${formatAmount(request.ImpTrib)}</ar:ImpTrib>` +
    `<ar:ImpIVA>${formatAmount(request.ImpIVA)}</ar:ImpIVA>` +
    `<ar:MonId>${request.MonId}</ar:MonId>` +
    `<ar:MonCotiz>${request.MonCotiz}</ar:MonCotiz>` +
    `<ar:CondicionIVAReceptorId>${request.CondicionIVAReceptorId}</ar:CondicionIVAReceptorId>` +
    (ivaXml ? `<ar:Iva>${ivaXml}</ar:Iva>` : "") +
    `</ar:FECAEDetRequest>`
  );
}

export async function callFeCaeSolicitar(
  wsfeUrl: string,
  auth: ArcaAuthTicket,
  cuit: string,
  request: WsfeInvoiceRequest,
): Promise<WsfeCaeResult> {
  const bodyXml =
    `<ar:FECAESolicitar>` +
    authXml(auth, cuit) +
    `<ar:FeCAEReq>` +
    `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${request.PtoVta}</ar:PtoVta><ar:CbteTipo>${request.CbteTipo}</ar:CbteTipo></ar:FeCabReq>` +
    `<ar:FeDetReq>${buildFeCaeDetReqXml(request)}</ar:FeDetReq>` +
    `</ar:FeCAEReq>` +
    `</ar:FECAESolicitar>`;

  const body = await soapPost(wsfeUrl, "FECAESolicitar", bodyXml);
  const result = (body.FECAESolicitarResponse as Record<string, unknown> | undefined)?.FECAESolicitarResult as
    | Record<string, unknown>
    | undefined;
  if (!result) throw new WsfeResponseParseError("falta FECAESolicitarResult");

  const topLevelErrors = mapObservations(
    (result.Errors as Record<string, unknown> | undefined)?.Err as RawObs | RawObs[] | undefined,
  );
  const events = mapObservations((result.Events as Record<string, unknown> | undefined)?.Evt as RawObs | RawObs[] | undefined);

  const feDetResp = result.FeDetResp as Record<string, unknown> | undefined;
  const detail = feDetResp?.FECAEDetResponse as Record<string, unknown> | undefined;
  if (!detail) {
    // No per-voucher detail at all (e.g. a header-level rejection before
    // ARCA even evaluated the line) — still a real, distinguishable
    // REJECTED outcome, never silently treated as approved.
    throw new WsfeFaultError(
      topLevelErrors.length > 0
        ? topLevelErrors.map((e) => `[${e.code}] ${e.message}`).join("; ")
        : "la respuesta no contiene el detalle del comprobante",
    );
  }

  const observations = mapObservations(
    (detail.Observaciones as Record<string, unknown> | undefined)?.Obs as RawObs | RawObs[] | undefined,
  );
  const voucherNumber = Number(detail.CbteDesde ?? request.CbteDesde);
  const resultado = String(detail.Resultado ?? "");

  if (resultado === "A") {
    const cae = String(detail.CAE ?? "");
    const caeExpiresAtRaw = String(detail.CAEFchVto ?? "");
    const caeExpiresAt = parseArcaDate(caeExpiresAtRaw);
    if (!cae || !caeExpiresAt) {
      throw new WsfeResponseParseError("comprobante aprobado sin CAE o vencimiento válidos");
    }
    return { outcome: "APPROVED", cae, caeExpiresAt, voucherNumber, observations, events };
  }

  return {
    outcome: "REJECTED",
    voucherNumber,
    observations,
    errors: topLevelErrors,
    events,
  };
}

// =============================================================================
// FECompConsultar — reconciliation query (section 17): given a voucher
// number this integration itself intended to request, ask ARCA directly
// whether it was actually authorized, instead of blindly retrying after an
// uncertain-outcome network failure.
// =============================================================================

export interface WsfeVoucherDetail {
  found: boolean;
  cae: string | null;
  caeExpiresAt: Date | null;
  totalAmount: number | null;
}

export async function callFeCompConsultar(
  wsfeUrl: string,
  auth: ArcaAuthTicket,
  cuit: string,
  input: WsfeLastVoucherInput & { voucherNumber: number },
): Promise<WsfeVoucherDetail> {
  const bodyXml =
    `<ar:FECompConsultar>` +
    authXml(auth, cuit) +
    `<ar:FeCompConsReq>` +
    `<ar:CbteTipo>${input.documentTypeCode}</ar:CbteTipo>` +
    `<ar:CbteNro>${input.voucherNumber}</ar:CbteNro>` +
    `<ar:PtoVta>${input.pointOfSale}</ar:PtoVta>` +
    `</ar:FeCompConsReq>` +
    `</ar:FECompConsultar>`;

  const body = await soapPost(wsfeUrl, "FECompConsultar", bodyXml);
  const result = (body.FECompConsultarResponse as Record<string, unknown> | undefined)?.FECompConsultarResult as
    | Record<string, unknown>
    | undefined;
  if (!result) throw new WsfeResponseParseError("falta FECompConsultarResult");

  const errors = mapObservations((result.Errors as Record<string, unknown> | undefined)?.Err as RawObs | RawObs[] | undefined);
  const resultGet = result.ResultGet as Record<string, unknown> | undefined;

  // ARCA returns an Errors entry (commonly code 602, "Comprobante
  // inexistente") rather than a SOAP Fault when the queried voucher was
  // never actually authorized — this is the expected, real "not found"
  // signal the reconciliation service relies on to know it's safe to
  // retry, never treated as a network/protocol failure.
  if (!resultGet || errors.length > 0) {
    return { found: false, cae: null, caeExpiresAt: null, totalAmount: null };
  }

  const cae = resultGet.CodAutorizacion ? String(resultGet.CodAutorizacion) : null;
  const caeExpiresAt = resultGet.FchVto ? parseArcaDate(String(resultGet.FchVto)) : null;
  const totalAmount = resultGet.ImpTotal !== undefined ? Number(resultGet.ImpTotal) : null;

  return { found: true, cae, caeExpiresAt, totalAmount: Number.isFinite(totalAmount) ? totalAmount : null };
}

// =============================================================================
// FEParamGetTiposIva — live parameter verification (section 26). Only
// table this integration actually needs live-verified — see arca-codes.ts's
// own ARCA_ALICUOTA_IVA_CODE header comment for why the others aren't
// modeled at all.
// =============================================================================

export interface WsfeIvaTypeParam {
  id: string;
  description: string;
}

export async function callFeParamGetTiposIva(
  wsfeUrl: string,
  auth: ArcaAuthTicket,
  cuit: string,
): Promise<WsfeIvaTypeParam[]> {
  const bodyXml = `<ar:FEParamGetTiposIva>${authXml(auth, cuit)}</ar:FEParamGetTiposIva>`;
  const body = await soapPost(wsfeUrl, "FEParamGetTiposIva", bodyXml);
  const result = (body.FEParamGetTiposIvaResponse as Record<string, unknown> | undefined)?.FEParamGetTiposIvaResult as
    | Record<string, unknown>
    | undefined;
  if (!result) throw new WsfeResponseParseError("falta FEParamGetTiposIvaResult");

  const resultGet = result.ResultGet as Record<string, unknown> | undefined;
  const rows = toArray(resultGet?.IvaTipo as Record<string, unknown> | Record<string, unknown>[] | undefined);
  return rows.map((row) => ({ id: String(row.Id ?? ""), description: String(row.Desc ?? "") }));
}
