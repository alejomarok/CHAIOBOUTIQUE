// Node-safe core: no "server-only" import — but transitively pulls in
// certificate-core.ts's "node:fs/promises" usage, so (like that module)
// this only ever runs in a real Node process. Signing + network half of
// WSAA — see wsaa-tra-core.ts for the pure XML build/parse half this module
// orchestrates around.
//
// CMS structure is encoded by PKIjs; signatures use the native Node WebCrypto implementation.
import { createPrivateKey, webcrypto, X509Certificate } from "node:crypto";
import * as asn1js from "asn1js";
import {
  Attribute,
  Certificate,
  ContentInfo,
  CryptoEngine,
  EncapsulatedContentInfo,
  IssuerAndSerialNumber,
  SignedAndUnsignedAttributes,
  SignedData,
  SignerInfo,
} from "pkijs";
import { XMLParser } from "fast-xml-parser";

import type { ArcaEnvironment } from "@/generated/prisma/client";

import { readArcaCertificateFiles, ArcaCertificateInvalidError } from "./certificate-core";
import { ARCA_WSAA_URL } from "./endpoints-core";
import {
  buildLoginTicketRequestXml,
  parseLoginTicketResponseXml,
  WsaaFaultError,
  WsaaResponseParseError,
  type LoginTicketResponse,
} from "./wsaa-tra-core";

export class WsaaNetworkError extends Error {
  constructor(cause: string) {
    super(`No se pudo contactar al servicio WSAA de ARCA: ${cause}.`);
    this.name = "WsaaNetworkError";
  }
}

// Uses the platform's OpenSSL/WebCrypto primitives and PKIjs for CMS encoding.
// The vulnerable node-forge verifier is not shipped in the application runtime.
export async function signTicketRequestCms(traXml: string): Promise<string> {
  const { certificatePem, privateKeyPem, passphrase } = await readArcaCertificateFiles();
  try {
    const x509 = new X509Certificate(certificatePem);
    const privateKey = createPrivateKey({
      key: privateKeyPem,
      passphrase: passphrase ?? undefined,
    });
    if (!x509.checkPrivateKey(privateKey))
      throw new Error("El certificado no corresponde a la clave privada.");
    const der = privateKey.export({ format: "der", type: "pkcs8" });
    const key = await webcrypto.subtle.importKey(
      "pkcs8",
      new Uint8Array(der),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const certificate = Certificate.fromBER(new Uint8Array(x509.raw));
    const data = new TextEncoder().encode(traXml);
    const digest = await webcrypto.subtle.digest("SHA-256", data);
    const signed = new SignedData({
      encapContentInfo: new EncapsulatedContentInfo({
        eContentType: ContentInfo.DATA,
        eContent: new asn1js.OctetString({ valueHex: data.buffer }),
      }),
      certificates: [certificate],
      signerInfos: [
        new SignerInfo({
          sid: new IssuerAndSerialNumber({
            issuer: certificate.issuer,
            serialNumber: certificate.serialNumber,
          }),
          signedAttrs: new SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new Attribute({
                type: "1.2.840.113549.1.9.3",
                values: [new asn1js.ObjectIdentifier({ value: ContentInfo.DATA })],
              }),
              new Attribute({
                type: "1.2.840.113549.1.9.4",
                values: [new asn1js.OctetString({ valueHex: digest })],
              }),
              new Attribute({
                type: "1.2.840.113549.1.9.5",
                values: [new asn1js.UTCTime({ valueDate: new Date() })],
              }),
            ],
          }),
        }),
      ],
    });
    const engine = new CryptoEngine({ name: "node", crypto: webcrypto as unknown as Crypto });
    await signed.sign(key as unknown as CryptoKey, 0, "SHA-256", undefined, engine);
    const cms = new ContentInfo({
      contentType: ContentInfo.SIGNED_DATA,
      content: signed.toSchema(true),
    });
    return Buffer.from(cms.toSchema().toBER(false)).toString("base64");
  } catch {
    throw new ArcaCertificateInvalidError(
      "no se pudo firmar; verificá el certificado, la clave privada y su contraseña",
    );
  }
}
// Raw SOAP 1.1 call to WSAA's loginCms method — hand-built envelope rather
// than a WSDL-driven dynamic client (see this phase's own "deterministic,
// small, fixed set of hand-built SOAP envelopes" dependency justification:
// WSAA/WSFEv1 between them expose only a handful of methods this
// integration ever calls, so a general-purpose `soap` package's WSDL
// parsing overhead buys nothing here).
export async function callWsaaLoginCms(
  cmsBase64: string,
  wsaaUrl: string,
): Promise<LoginTicketResponse> {
  const envelope =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">` +
    `<soapenv:Header/>` +
    `<soapenv:Body>` +
    `<wsaa:loginCms>` +
    `<wsaa:in0>${cmsBase64}</wsaa:in0>` +
    `</wsaa:loginCms>` +
    `</soapenv:Body>` +
    `</soapenv:Envelope>`;

  let responseText: string;
  try {
    const response = await fetch(wsaaUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "",
      },
      body: envelope,
    });
    responseText = await response.text();
    if (!response.ok && !responseText.includes("Fault")) {
      throw new WsaaNetworkError(`HTTP ${response.status}`);
    }
  } catch (error) {
    if (error instanceof WsaaNetworkError) throw error;
    throw new WsaaNetworkError(error instanceof Error ? error.message : "error de red desconocido");
  }

  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    removeNSPrefix: true,
  });
  let parsedEnvelope: unknown;
  try {
    parsedEnvelope = parser.parse(responseText);
  } catch (error) {
    throw new WsaaResponseParseError(
      error instanceof Error ? error.message : "sobre SOAP inválido",
    );
  }

  const body = (parsedEnvelope as Record<string, unknown>)?.Envelope as
    Record<string, unknown> | undefined;
  const bodyContent = body?.Body as Record<string, unknown> | undefined;

  const fault = bodyContent?.Fault as Record<string, unknown> | undefined;
  if (fault) {
    const faultString =
      typeof fault.faultstring === "string" ? fault.faultstring : "error desconocido";
    throw new WsaaFaultError(faultString);
  }

  const loginCmsResponse = bodyContent?.loginCmsResponse as Record<string, unknown> | undefined;
  const loginCmsReturn = loginCmsResponse?.loginCmsReturn;
  if (typeof loginCmsReturn !== "string" || !loginCmsReturn) {
    throw new WsaaResponseParseError("la respuesta no contiene loginCmsReturn");
  }

  return parseLoginTicketResponseXml(loginCmsReturn);
}

// Clock-skew buffer for the TRA's own generation/expiration window — see
// wsaa-tra-core.ts's own comment: this is the window during which the
// SIGNED REQUEST itself is considered valid to submit, deliberately
// generous and symmetric around "now" to tolerate a client clock a few
// minutes off from ARCA's server clock. Distinct from the returned
// ticket's own (much longer, ~12h) validity, which the caller reads back
// from LoginTicketResponse.header.expirationTime — never assumed locally.
const TRA_CLOCK_SKEW_BUFFER_MS = 10 * 60 * 1000;

// Orchestrates one full WSAA login: build TRA -> sign as CMS -> call
// loginCms -> parse Token/Sign/expiration. Callers (auth-provider-core.ts)
// are responsible for caching the result and for the HOMOLOGATION-only
// hard-fail gate — this function itself just performs the one real login
// call for whichever environment/URL it's given.
export async function requestArcaAccessTicket(
  environment: ArcaEnvironment,
  service: string,
): Promise<LoginTicketResponse> {
  const now = new Date();
  const traXml = buildLoginTicketRequestXml({
    service,
    uniqueId: Math.floor(now.getTime() / 1000),
    generationTime: new Date(now.getTime() - TRA_CLOCK_SKEW_BUFFER_MS),
    expirationTime: new Date(now.getTime() + TRA_CLOCK_SKEW_BUFFER_MS),
  });
  const cmsBase64 = await signTicketRequestCms(traXml);
  return callWsaaLoginCms(cmsBase64, ARCA_WSAA_URL[environment]);
}
