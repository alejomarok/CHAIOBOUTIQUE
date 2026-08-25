// Node-safe core: no "server-only" import — but transitively pulls in
// certificate-core.ts's "node:fs/promises" usage, so (like that module)
// this only ever runs in a real Node process. Signing + network half of
// WSAA — see wsaa-tra-core.ts for the pure XML build/parse half this module
// orchestrates around.
//
// Uses node-forge for CMS/PKCS#7 signing (see this phase's own dependency
// justification: a pure-JS, audited, no-native-bindings, no-local-OpenSSL-
// CLI library — the de facto standard choice for this exact "sign a small
// XML document as a CMS SignedData structure" need in the Node.js
// Argentine developer ecosystem) — never hand-rolled ASN.1/crypto.
import forge from "node-forge";
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

function decryptPrivateKey(privateKeyPem: string, passphrase: string | null): forge.pki.PrivateKey {
  if (passphrase) {
    const decrypted = forge.pki.decryptRsaPrivateKey(privateKeyPem, passphrase);
    if (!decrypted) {
      throw new ArcaCertificateInvalidError("no se pudo desencriptar la clave privada con la passphrase configurada");
    }
    return decrypted;
  }
  try {
    return forge.pki.privateKeyFromPem(privateKeyPem);
  } catch (error) {
    throw new ArcaCertificateInvalidError(
      `no se pudo leer la clave privada (${error instanceof Error ? error.message : "formato no reconocido"})`,
    );
  }
}

// Builds a CMS (PKCS#7) SignedData structure over the TRA XML, using the
// configured certificate/private key — the exact document WSAA's loginCms
// method expects as its base64-encoded `in0` parameter. Never detached
// (WSAA needs the signed content embedded, not a separate signature) —
// this is the one deliberate difference from a typical "sign a hash"
// PKCS#7 use case.
export async function signTicketRequestCms(traXml: string): Promise<string> {
  const { certificatePem, privateKeyPem, passphrase } = await readArcaCertificateFiles();

  let certificate: forge.pki.Certificate;
  try {
    certificate = forge.pki.certificateFromPem(certificatePem);
  } catch (error) {
    throw new ArcaCertificateInvalidError(error instanceof Error ? error.message : "formato de certificado no reconocido");
  }
  // Re-serialized to a plain PEM string (rather than passed as the forge
  // PrivateKey object directly) — sidesteps a @types/node-forge definition
  // mismatch between pki.decryptRsaPrivateKey's declared return type and
  // pkcs7.addSigner's own expected `key` type; forge's own runtime code
  // accepts either form identically.
  const privateKeyPemNormalized = forge.pki.privateKeyToPem(decryptPrivateKey(privateKeyPem, passphrase));

  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(traXml, "utf8");
  p7.addCertificate(certificate);
  p7.addSigner({
    key: privateKeyPemNormalized,
    certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      // node-forge's own runtime accepts a Date here and formats it as
      // UTCTime internally — @types/node-forge's signature is
      // overly-strict (string-only), hence the cast.
      { type: forge.pki.oids.signingTime, value: new Date() as unknown as string },
    ],
  });
  p7.sign();

  const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return forge.util.encode64(der);
}

// Raw SOAP 1.1 call to WSAA's loginCms method — hand-built envelope rather
// than a WSDL-driven dynamic client (see this phase's own "deterministic,
// small, fixed set of hand-built SOAP envelopes" dependency justification:
// WSAA/WSFEv1 between them expose only a handful of methods this
// integration ever calls, so a general-purpose `soap` package's WSDL
// parsing overhead buys nothing here).
export async function callWsaaLoginCms(cmsBase64: string, wsaaUrl: string): Promise<LoginTicketResponse> {
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

  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, removeNSPrefix: true });
  let parsedEnvelope: unknown;
  try {
    parsedEnvelope = parser.parse(responseText);
  } catch (error) {
    throw new WsaaResponseParseError(error instanceof Error ? error.message : "sobre SOAP inválido");
  }

  const body = (parsedEnvelope as Record<string, unknown>)?.Envelope as Record<string, unknown> | undefined;
  const bodyContent = body?.Body as Record<string, unknown> | undefined;

  const fault = bodyContent?.Fault as Record<string, unknown> | undefined;
  if (fault) {
    const faultString = typeof fault.faultstring === "string" ? fault.faultstring : "error desconocido";
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
