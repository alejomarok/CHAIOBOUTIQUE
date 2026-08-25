import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import forge from "node-forge";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { env } from "@/lib/env-core";
import {
  ArcaCertificateInvalidError,
  ArcaCertificateNotConfiguredError,
  ArcaCertificateUnreadableError,
  getArcaCertificateInfo,
  loadArcaCertificateConfig,
} from "@/modules/fiscal-documents/arca/certificate-core";

function generateSelfSignedCertPem(notAfter: Date): string {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 24 * 60 * 60 * 1000);
  cert.validity.notAfter = notAfter;
  const attrs = [{ name: "commonName", value: "test.chaioboutique.local" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return forge.pki.certificateToPem(cert);
}

describe("certificate-core", () => {
  let tmpDir: string;
  const originalCertPath = env.ARCA_CERTIFICATE_PATH;
  const originalKeyPath = env.ARCA_PRIVATE_KEY_PATH;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "arca-test-cert-info-"));
  });
  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
  afterEach(() => {
    env.ARCA_CERTIFICATE_PATH = originalCertPath;
    env.ARCA_PRIVATE_KEY_PATH = originalKeyPath;
  });

  it("loadArcaCertificateConfig returns null when either path is unset", () => {
    env.ARCA_CERTIFICATE_PATH = undefined;
    env.ARCA_PRIVATE_KEY_PATH = undefined;
    expect(loadArcaCertificateConfig()).toBeNull();
  });

  it("getArcaCertificateInfo throws ArcaCertificateNotConfiguredError when unset", async () => {
    env.ARCA_CERTIFICATE_PATH = undefined;
    env.ARCA_PRIVATE_KEY_PATH = undefined;
    await expect(getArcaCertificateInfo()).rejects.toThrow(ArcaCertificateNotConfiguredError);
  });

  it("getArcaCertificateInfo throws ArcaCertificateUnreadableError when the file doesn't exist", async () => {
    env.ARCA_CERTIFICATE_PATH = join(tmpDir, "does-not-exist.pem");
    env.ARCA_PRIVATE_KEY_PATH = join(tmpDir, "does-not-exist.key");
    await expect(getArcaCertificateInfo()).rejects.toThrow(ArcaCertificateUnreadableError);
  });

  it("getArcaCertificateInfo throws ArcaCertificateInvalidError for a file that isn't a real certificate", async () => {
    const certPath = join(tmpDir, "garbage.pem");
    const keyPath = join(tmpDir, "garbage.key");
    writeFileSync(certPath, "not a real certificate", "utf8");
    writeFileSync(keyPath, "not a real key", "utf8");
    env.ARCA_CERTIFICATE_PATH = certPath;
    env.ARCA_PRIVATE_KEY_PATH = keyPath;
    await expect(getArcaCertificateInfo()).rejects.toThrow(ArcaCertificateInvalidError);
  });

  it("reports isExpired:false for a currently-valid certificate and extracts its common name", async () => {
    const certPath = join(tmpDir, "valid.pem");
    const keyPath = join(tmpDir, "valid.key");
    writeFileSync(certPath, generateSelfSignedCertPem(new Date(Date.now() + 24 * 60 * 60 * 1000)), "utf8");
    writeFileSync(keyPath, "placeholder — never read by getArcaCertificateInfo", "utf8");
    env.ARCA_CERTIFICATE_PATH = certPath;
    env.ARCA_PRIVATE_KEY_PATH = keyPath;

    const info = await getArcaCertificateInfo();
    expect(info.isExpired).toBe(false);
    expect(info.subjectCommonName).toBe("test.chaioboutique.local");
  });

  it("reports isExpired:true for an already-expired certificate", async () => {
    const certPath = join(tmpDir, "expired.pem");
    const keyPath = join(tmpDir, "expired.key");
    writeFileSync(certPath, generateSelfSignedCertPem(new Date(Date.now() - 60 * 60 * 1000)), "utf8");
    writeFileSync(keyPath, "placeholder", "utf8");
    env.ARCA_CERTIFICATE_PATH = certPath;
    env.ARCA_PRIVATE_KEY_PATH = keyPath;

    const info = await getArcaCertificateInfo();
    expect(info.isExpired).toBe(true);
  });
});
