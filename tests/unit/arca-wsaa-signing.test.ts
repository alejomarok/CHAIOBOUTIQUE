// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import { ContentInfo, CryptoEngine, SignedData } from "pkijs";

import forge from "node-forge";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { env } from "@/lib/env-core";
import { callWsaaLoginCms, signTicketRequestCms } from "@/modules/fiscal-documents/arca/wsaa-core";
import {
  WsaaFaultError,
  WsaaResponseParseError,
} from "@/modules/fiscal-documents/arca/wsaa-tra-core";

// Generates a throwaway, test-only self-signed certificate/key pair — NEVER
// a real ARCA certificate (this suite must never require one — see this
// phase's explicit "no certificate required for the normal test suite"
// requirement). Proves the real CMS/PKCS#7 signing code (node-forge) works
// structurally end to end, independent of any real ARCA credential.
function generateSelfSignedCertPem(): { certPem: string; keyPem: string } {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const attrs = [{ name: "commonName", value: "test.chaioboutique.local" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(keys.privateKey),
  };
}

describe("signTicketRequestCms", () => {
  let tmpDir: string;
  const originalCertPath = env.ARCA_CERTIFICATE_PATH;
  const originalKeyPath = env.ARCA_PRIVATE_KEY_PATH;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "arca-test-cert-"));
    const { certPem, keyPem } = generateSelfSignedCertPem();
    const certPath = join(tmpDir, "test.pem");
    const keyPath = join(tmpDir, "test.key");
    writeFileSync(certPath, certPem, "utf8");
    writeFileSync(keyPath, keyPem, "utf8");
    env.ARCA_CERTIFICATE_PATH = certPath;
    env.ARCA_PRIVATE_KEY_PATH = keyPath;
  });

  afterAll(() => {
    env.ARCA_CERTIFICATE_PATH = originalCertPath;
    env.ARCA_PRIVATE_KEY_PATH = originalKeyPath;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces a well-formed, independently-parseable base64 CMS SignedData structure embedding the original TRA XML", async () => {
    const traXml = `<?xml version="1.0"?><loginTicketRequest version="1.0"><service>wsfe</service></loginTicketRequest>`;
    const cmsBase64 = await signTicketRequestCms(traXml);

    expect(cmsBase64.length).toBeGreaterThan(0);
    const der = forge.util.decode64(cmsBase64);
    const asn1 = forge.asn1.fromDer(der);

    // A genuine, structurally valid PKCS#7 SignedData message — forge
    // throws if the ASN.1 doesn't actually conform to the SignedData
    // shape (wrong OIDs/structure), which is exactly what a hand-rolled
    // or broken signing implementation would fail to produce.
    const p7 = forge.pkcs7.messageFromAsn1(asn1) as forge.pkcs7.PkcsSignedData;
    expect(p7.certificates).toHaveLength(1);

    // The content is embedded (attached, not detached — WSAA requires the
    // full signed content, not just a signature over an external
    // document) as plain UTF-8 bytes within the SignedData's ContentInfo —
    // present verbatim in the DER encoding.
    expect(der).toContain(traXml);
    const cms = new ContentInfo({
      schema: asn1js.fromBER(Buffer.from(cmsBase64, "base64")).result,
    });
    const signed = new SignedData({ schema: cms.content });
    const engine = new CryptoEngine({ name: "node", crypto: webcrypto as unknown as Crypto });
    expect(await signed.verify({ signer: 0, checkChain: false }, engine)).toBe(true);
  });
});

const WSAA_URL = "https://wsaahomo.afip.gov.ar/ws/services/LoginCms";

function soapEnvelope(bodyXml: string): string {
  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>${bodyXml}</soap:Body>` +
    `</soap:Envelope>`
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("callWsaaLoginCms", () => {
  it("unwraps loginCmsReturn and parses the inner LoginTicketResponse", async () => {
    const innerXml =
      `<loginTicketResponse version="1.0"><header><expirationTime>2026-01-01T22:00:00-03:00</expirationTime></header>` +
      `<credentials><token>TOKEN1</token><sign>SIGN1</sign></credentials></loginTicketResponse>`;
    const escapedInner = innerXml.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () =>
          soapEnvelope(
            `<loginCmsResponse xmlns="http://wsaa.view.sua.dvadac.desein.afip.gov"><loginCmsReturn>${escapedInner}</loginCmsReturn></loginCmsResponse>`,
          ),
      })),
    );

    const result = await callWsaaLoginCms("BASE64-CMS", WSAA_URL);
    expect(result.token).toBe("TOKEN1");
    expect(result.sign).toBe("SIGN1");
  });

  it("throws WsaaFaultError on a SOAP Fault (e.g. certificate already has a valid ticket)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () =>
          soapEnvelope(
            `<soap:Fault><faultcode>soap:Server</faultcode><faultstring>El CEE ya posee un TA valido</faultstring></soap:Fault>`,
          ),
      })),
    );

    await expect(callWsaaLoginCms("BASE64-CMS", WSAA_URL)).rejects.toThrow(WsaaFaultError);
  });

  it("throws WsaaResponseParseError when the response has no loginCmsReturn", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => soapEnvelope(`<somethingElse/>`),
      })),
    );

    await expect(callWsaaLoginCms("BASE64-CMS", WSAA_URL)).rejects.toThrow(WsaaResponseParseError);
  });
});
