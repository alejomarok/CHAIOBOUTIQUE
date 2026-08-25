// Node-safe core: no "server-only" import (mirrors every other -core.ts in
// this directory) — but this module DOES use Node's "node:fs/promises",
// so it can only ever run in a real Node process (a Next.js Server
// Action/Route Handler, a test file, a script), never the Edge runtime or a
// browser. That's an inherent property of reading a certificate file off
// disk, not a boundary violation — no Client Component ever imports this.
//
// Phase — ARCA Homologation: Real WSAA + WSFEv1 Integration. Loads the
// ARCA_CERTIFICATE_PATH/ARCA_PRIVATE_KEY_PATH file PATHS from env (see
// env-core.ts's own comment for why paths, never raw PEM content, are the
// configured value) and parses just enough of the certificate to answer
// "is this actually usable" — subject common name, validity window,
// expiration — for the admin readiness card. NEVER returns the private key
// material, the raw certificate PEM, or logs either — see this phase's
// explicit "never log/print private key or certificate private material"
// requirement.
import { readFile } from "node:fs/promises";

import forge from "node-forge";

import { env } from "@/lib/env-core";

export class ArcaCertificateNotConfiguredError extends Error {
  constructor() {
    super("El certificado de ARCA todavía no está configurado.");
    this.name = "ArcaCertificateNotConfiguredError";
  }
}

export class ArcaCertificateUnreadableError extends Error {
  constructor(which: "certificate" | "privateKey") {
    super(
      which === "certificate"
        ? "No se pudo leer el archivo del certificado de ARCA."
        : "No se pudo leer el archivo de la clave privada de ARCA.",
    );
    this.name = "ArcaCertificateUnreadableError";
  }
}

export class ArcaCertificateInvalidError extends Error {
  constructor(reason: string) {
    super(`El certificado de ARCA no es válido: ${reason}.`);
    this.name = "ArcaCertificateInvalidError";
  }
}

export interface ArcaCertificateConfig {
  certificatePath: string;
  privateKeyPath: string;
  passphrase: string | null;
}

// null (not a throw) when either path is unset — "not configured" is a
// normal, expected state this whole phase, not an error condition, exactly
// like getMercadoPagoConfig's own posture for an unconfigured integration.
export function loadArcaCertificateConfig(): ArcaCertificateConfig | null {
  if (!env.ARCA_CERTIFICATE_PATH || !env.ARCA_PRIVATE_KEY_PATH) return null;
  return {
    certificatePath: env.ARCA_CERTIFICATE_PATH,
    privateKeyPath: env.ARCA_PRIVATE_KEY_PATH,
    passphrase: env.ARCA_PRIVATE_KEY_PASSPHRASE ?? null,
  };
}

export interface ArcaCertificateFiles {
  certificatePem: string;
  privateKeyPem: string;
  passphrase: string | null;
}

// Reads the raw PEM contents off disk. Callers (wsaa-core.ts) hold the
// result only in memory, only for the duration of building/signing one TRA
// — never persisted, never logged.
export async function readArcaCertificateFiles(): Promise<ArcaCertificateFiles> {
  const config = loadArcaCertificateConfig();
  if (!config) throw new ArcaCertificateNotConfiguredError();

  let certificatePem: string;
  try {
    certificatePem = await readFile(config.certificatePath, "utf8");
  } catch {
    throw new ArcaCertificateUnreadableError("certificate");
  }

  let privateKeyPem: string;
  try {
    privateKeyPem = await readFile(config.privateKeyPath, "utf8");
  } catch {
    throw new ArcaCertificateUnreadableError("privateKey");
  }

  return { certificatePem, privateKeyPem, passphrase: config.passphrase };
}

export interface ArcaCertificateInfo {
  subjectCommonName: string | null;
  notBefore: Date;
  notAfter: Date;
  isExpired: boolean;
}

// Parses ONLY the public certificate (never the private key) to answer
// "is this certificate itself still valid" for the readiness card. Throws
// ArcaCertificateInvalidError on a file that exists but isn't a parseable
// X.509 PEM certificate — a real, actionable admin-facing signal, never a
// silent "not ready" indistinguishable from "not configured at all".
export async function getArcaCertificateInfo(): Promise<ArcaCertificateInfo> {
  const { certificatePem } = await readArcaCertificateFiles();

  let certificate: forge.pki.Certificate;
  try {
    certificate = forge.pki.certificateFromPem(certificatePem);
  } catch (error) {
    throw new ArcaCertificateInvalidError(error instanceof Error ? error.message : "formato no reconocido");
  }

  const notBefore = certificate.validity.notBefore;
  const notAfter = certificate.validity.notAfter;
  const commonNameField = certificate.subject.getField("CN");

  return {
    subjectCommonName: commonNameField ? commonNameField.value : null,
    notBefore,
    notAfter,
    isExpired: Date.now() < notBefore.getTime() || Date.now() > notAfter.getTime(),
  };
}
