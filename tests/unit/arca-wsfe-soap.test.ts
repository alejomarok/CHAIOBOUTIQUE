import { afterEach, describe, expect, it, vi } from "vitest";

import {
  callFeCaeSolicitar,
  callFeCompConsultar,
  callFeCompUltimoAutorizado,
  callFeDummy,
  callFeParamGetTiposIva,
  WsfeFaultError,
  WsfeNetworkError,
  WsfeResponseParseError,
} from "@/modules/fiscal-documents/arca/wsfe-soap-core";
import type { WsfeInvoiceRequest } from "@/modules/fiscal-documents/arca/wsfe-request-builder-core";
import type { ArcaAuthTicket } from "@/modules/fiscal-documents/arca/auth-provider-core";

const AUTH: ArcaAuthTicket = { token: "T", sign: "S", expiresAt: new Date() };
const CUIT = "30-71234567-9";
const WSFE_URL = "https://wswhomo.afip.gov.ar/wsfev1/service.asmx";

function soapEnvelope(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>${bodyXml}</soap:Body>` +
    `</soap:Envelope>`
  );
}

function mockFetchOnce(responseText: string, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok, status: ok ? 200 : 500, text: async () => responseText })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callFeDummy", () => {
  it("parses AppServer/DbServer/AuthServer", async () => {
    mockFetchOnce(
      soapEnvelope(
        `<FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult>` +
          `<AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>` +
          `</FEDummyResult></FEDummyResponse>`,
      ),
    );
    const result = await callFeDummy(WSFE_URL);
    expect(result).toEqual({ appServer: "OK", dbServer: "OK", authServer: "OK" });
  });

  it("throws WsfeFaultError on a SOAP Fault", async () => {
    mockFetchOnce(
      soapEnvelope(`<soap:Fault><faultcode>soap:Client</faultcode><faultstring>No autorizado</faultstring></soap:Fault>`),
      false,
    );
    await expect(callFeDummy(WSFE_URL)).rejects.toThrow(WsfeFaultError);
  });

  it("throws WsfeNetworkError when fetch itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    await expect(callFeDummy(WSFE_URL)).rejects.toThrow(WsfeNetworkError);
  });
});

describe("callFeCompUltimoAutorizado", () => {
  it("returns CbteNro as a number", async () => {
    mockFetchOnce(
      soapEnvelope(
        `<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult>` +
          `<PtoVta>1</PtoVta><CbteTipo>6</CbteTipo><CbteNro>42</CbteNro>` +
          `</FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`,
      ),
    );
    const result = await callFeCompUltimoAutorizado(WSFE_URL, AUTH, CUIT, { pointOfSale: 1, documentTypeCode: 6 });
    expect(result).toBe(42);
  });
});

const BASE_REQUEST: WsfeInvoiceRequest = {
  CbteTipo: 6,
  PtoVta: 1,
  Concepto: 1,
  DocTipo: 96,
  DocNro: "30123456",
  CbteFch: "20260101",
  ImpTotal: 1210,
  ImpNeto: 1000,
  ImpIVA: 210,
  ImpTotConc: 0,
  ImpOpEx: 0,
  ImpTrib: 0,
  MonId: "PES",
  MonCotiz: 1,
  CondicionIVAReceptorId: 5,
  CbteDesde: 1,
  CbteHasta: 1,
  Iva: [{ Id: 5, BaseImp: 1000, Importe: 210 }],
};

describe("callFeCaeSolicitar", () => {
  it("parses an APPROVED (Resultado A) response into an APPROVED outcome", async () => {
    mockFetchOnce(
      soapEnvelope(
        `<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>` +
          `<FeCabResp><Cuit>30712345679</Cuit><PtoVta>1</PtoVta><CbteTipo>6</CbteTipo><Resultado>A</Resultado></FeCabResp>` +
          `<FeDetResp><FECAEDetResponse><CbteDesde>1</CbteDesde><Resultado>A</Resultado>` +
          `<CAE>12345678901234</CAE><CAEFchVto>20260111</CAEFchVto></FECAEDetResponse></FeDetResp>` +
          `</FECAESolicitarResult></FECAESolicitarResponse>`,
      ),
    );
    const result = await callFeCaeSolicitar(WSFE_URL, AUTH, CUIT, BASE_REQUEST);
    expect(result.outcome).toBe("APPROVED");
    if (result.outcome === "APPROVED") {
      expect(result.cae).toBe("12345678901234");
      expect(result.caeExpiresAt.getUTCFullYear()).toBe(2026);
      expect(result.voucherNumber).toBe(1);
    }
  });

  it("parses a REJECTED (Resultado R) response into a REJECTED outcome with observations, never throwing", async () => {
    mockFetchOnce(
      soapEnvelope(
        `<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>` +
          `<FeCabResp><Resultado>R</Resultado></FeCabResp>` +
          `<FeDetResp><FECAEDetResponse><CbteDesde>1</CbteDesde><Resultado>R</Resultado>` +
          `<Observaciones><Obs><Code>10016</Code><Msg>Numeración inválida</Msg></Obs></Observaciones>` +
          `</FECAEDetResponse></FeDetResp>` +
          `</FECAESolicitarResult></FECAESolicitarResponse>`,
      ),
    );
    const result = await callFeCaeSolicitar(WSFE_URL, AUTH, CUIT, BASE_REQUEST);
    expect(result.outcome).toBe("REJECTED");
    if (result.outcome === "REJECTED") {
      expect(result.observations).toEqual([{ code: "10016", message: "Numeración inválida" }]);
    }
  });

  it("throws WsfeResponseParseError when an APPROVED result is missing its CAE", async () => {
    mockFetchOnce(
      soapEnvelope(
        `<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>` +
          `<FeCabResp><Resultado>A</Resultado></FeCabResp>` +
          `<FeDetResp><FECAEDetResponse><CbteDesde>1</CbteDesde><Resultado>A</Resultado></FECAEDetResponse></FeDetResp>` +
          `</FECAESolicitarResult></FECAESolicitarResponse>`,
      ),
    );
    await expect(callFeCaeSolicitar(WSFE_URL, AUTH, CUIT, BASE_REQUEST)).rejects.toThrow(WsfeResponseParseError);
  });
});

describe("callFeCompConsultar", () => {
  it("returns found:true with CAE details when ARCA has the voucher on record", async () => {
    mockFetchOnce(
      soapEnvelope(
        `<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult>` +
          `<ResultGet><CodAutorizacion>12345678901234</CodAutorizacion><FchVto>20260111</FchVto><ImpTotal>1210.00</ImpTotal></ResultGet>` +
          `</FECompConsultarResult></FECompConsultarResponse>`,
      ),
    );
    const result = await callFeCompConsultar(WSFE_URL, AUTH, CUIT, { pointOfSale: 1, documentTypeCode: 6, voucherNumber: 1 });
    expect(result.found).toBe(true);
    expect(result.cae).toBe("12345678901234");
    expect(result.totalAmount).toBe(1210);
  });

  it("returns found:false (never throws) when ARCA reports the voucher does not exist", async () => {
    mockFetchOnce(
      soapEnvelope(
        `<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult>` +
          `<Errors><Err><Code>602</Code><Msg>Comprobante inexistente</Msg></Err></Errors>` +
          `</FECompConsultarResult></FECompConsultarResponse>`,
      ),
    );
    const result = await callFeCompConsultar(WSFE_URL, AUTH, CUIT, { pointOfSale: 1, documentTypeCode: 6, voucherNumber: 999 });
    expect(result.found).toBe(false);
    expect(result.cae).toBeNull();
  });
});

describe("callFeParamGetTiposIva", () => {
  it("parses the IvaTipo array", async () => {
    mockFetchOnce(
      soapEnvelope(
        `<FEParamGetTiposIvaResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEParamGetTiposIvaResult><ResultGet>` +
          `<IvaTipo><Id>3</Id><Desc>0%</Desc></IvaTipo>` +
          `<IvaTipo><Id>5</Id><Desc>21%</Desc></IvaTipo>` +
          `</ResultGet></FEParamGetTiposIvaResult></FEParamGetTiposIvaResponse>`,
      ),
    );
    const result = await callFeParamGetTiposIva(WSFE_URL, AUTH, CUIT);
    expect(result).toEqual([
      { id: "3", description: "0%" },
      { id: "5", description: "21%" },
    ]);
  });
});
