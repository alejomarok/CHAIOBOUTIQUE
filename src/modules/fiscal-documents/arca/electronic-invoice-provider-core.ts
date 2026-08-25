// Node-safe core: no "server-only" import — mirrors auth-provider-core.ts's
// exact pattern, including its own independent HOMOLOGATION-only hard-fail
// (defense in depth: even if a caller somehow skipped that check, this
// provider refuses on its own before ever building a WSFEv1 URL).
import { env } from "@/lib/env-core";
import { getStoreConfiguration } from "@/modules/store-settings/service-core";

import type { ArcaAuthTicket } from "./auth-provider-core";
import { ArcaEnvironmentNotHomologationError } from "./auth-provider-core";
import { ARCA_WSFE_URL } from "./endpoints-core";
import type { WsfeInvoiceRequest } from "./wsfe-request-builder-core";
import {
  callFeCaeSolicitar,
  callFeCompConsultar,
  callFeCompUltimoAutorizado,
  callFeDummy,
  callFeParamGetTiposIva,
  type WsfeCaeResult,
  type WsfeDummyResult,
  type WsfeLastVoucherInput,
  type WsfeVoucherDetail,
} from "./wsfe-soap-core";

export class ArcaElectronicInvoiceNotConfiguredError extends Error {
  constructor() {
    super("La conexión con el servicio electrónico de ARCA (WSFEV1) todavía no está configurada.");
    this.name = "ArcaElectronicInvoiceNotConfiguredError";
  }
}

export type { WsfeCaeResult, WsfeDummyResult, WsfeLastVoucherInput, WsfeObservation, WsfeVoucherDetail } from "./wsfe-soap-core";

export interface ArcaElectronicInvoiceProvider {
  // Health-check / connectivity probe — WSFEv1's own FEDummy method. No
  // Auth required (this is the one method WSFEv1 answers unauthenticated).
  dummy(): Promise<WsfeDummyResult>;
  // The correlative-numbering seam (section 21): the ONLY source of truth
  // for "what's the last authorized voucher" — never derived from a local
  // FiscalDocument count/max. A future caller computes the next number as
  // this result + 1, immediately before building the request.
  getLastAuthorizedVoucher(input: WsfeLastVoucherInput, auth: ArcaAuthTicket, cuit: string): Promise<number>;
  // Never throws on a legitimate REJECTED outcome — see wsfe-soap-core.ts's
  // own callFeCaeSolicitar header comment.
  requestCae(request: WsfeInvoiceRequest, auth: ArcaAuthTicket, cuit: string): Promise<WsfeCaeResult>;
  // Reconciliation query (section 17) — never a substitute for
  // getLastAuthorizedVoucher's own numbering authority; this asks "was
  // THIS specific voucher number actually authorized".
  getVoucherDetail(
    input: WsfeLastVoucherInput & { voucherNumber: number },
    auth: ArcaAuthTicket,
    cuit: string,
  ): Promise<WsfeVoucherDetail>;
  // Live parameter/catalog lookup (section 26) — only "TiposIva" is
  // actually implemented against a real ARCA call; see arca-codes.ts's own
  // header comment for why the rest of ARCA's parameter tables aren't
  // modeled in this codebase at all.
  getParameterTable(tableName: string, auth: ArcaAuthTicket, cuit: string): Promise<unknown>;
}

async function resolveHomologationWsfeUrl(): Promise<string> {
  const config = await getStoreConfiguration();
  if (config.arcaEnvironment !== "HOMOLOGATION") {
    throw new ArcaEnvironmentNotHomologationError();
  }
  return ARCA_WSFE_URL.HOMOLOGATION;
}

export class RealArcaElectronicInvoiceProvider implements ArcaElectronicInvoiceProvider {
  async dummy(): Promise<WsfeDummyResult> {
    const url = await resolveHomologationWsfeUrl();
    return callFeDummy(url);
  }
  async getLastAuthorizedVoucher(input: WsfeLastVoucherInput, auth: ArcaAuthTicket, cuit: string): Promise<number> {
    const url = await resolveHomologationWsfeUrl();
    return callFeCompUltimoAutorizado(url, auth, cuit, input);
  }
  async requestCae(request: WsfeInvoiceRequest, auth: ArcaAuthTicket, cuit: string): Promise<WsfeCaeResult> {
    const url = await resolveHomologationWsfeUrl();
    return callFeCaeSolicitar(url, auth, cuit, request);
  }
  async getVoucherDetail(
    input: WsfeLastVoucherInput & { voucherNumber: number },
    auth: ArcaAuthTicket,
    cuit: string,
  ): Promise<WsfeVoucherDetail> {
    const url = await resolveHomologationWsfeUrl();
    return callFeCompConsultar(url, auth, cuit, input);
  }
  async getParameterTable(tableName: string, auth: ArcaAuthTicket, cuit: string): Promise<unknown> {
    const url = await resolveHomologationWsfeUrl();
    if (tableName === "TiposIva") return callFeParamGetTiposIva(url, auth, cuit);
    throw new Error(`Tabla de parámetros ARCA no soportada: "${tableName}".`);
  }
}

function voucherKey(pointOfSale: number, documentTypeCode: number): string {
  return `${pointOfSale}:${documentTypeCode}`;
}

// Deterministic, in-memory, no-network — but a REAL, working fake (not a
// throwing stub): this phase's entire ~25-item automated test list runs
// exclusively against this class (see this phase's explicit "never real
// ARCA, no certificate required for the normal suite" requirement), so it
// must genuinely model ARCA's own observable behavior for the scenarios
// those tests exercise — a stale/non-next voucher number is REJECTED (the
// same numbering-conflict rejection real ARCA would issue), never silently
// accepted, which is exactly what the numbering-race tests need to prove
// the advisory-lock strategy actually prevents.
export class FakeArcaElectronicInvoiceProvider implements ArcaElectronicInvoiceProvider {
  private lastVoucherByKey = new Map<string, number>();
  private issuedVouchers = new Map<string, { cae: string; caeExpiresAt: Date; totalAmount: number }>();
  private forcedNextOutcome: "REJECT" | "NETWORK_ERROR" | null = null;
  private requestCaeCallCount = 0;

  async dummy(): Promise<WsfeDummyResult> {
    return { appServer: "OK", dbServer: "OK", authServer: "OK" };
  }

  async getLastAuthorizedVoucher(input: WsfeLastVoucherInput): Promise<number> {
    return this.lastVoucherByKey.get(voucherKey(input.pointOfSale, input.documentTypeCode)) ?? 0;
  }

  async requestCae(request: WsfeInvoiceRequest): Promise<WsfeCaeResult> {
    this.requestCaeCallCount += 1;
    const outcome = this.forcedNextOutcome;
    this.forcedNextOutcome = null;

    if (outcome === "NETWORK_ERROR") {
      throw new Error("FakeArcaElectronicInvoiceProvider: simulated network failure (test only).");
    }

    const key = voucherKey(request.PtoVta, request.CbteTipo);
    const voucherNumber = request.CbteDesde;

    if (outcome === "REJECT") {
      return {
        outcome: "REJECTED",
        voucherNumber,
        observations: [],
        errors: [{ code: "FAKE", message: "Rechazo simulado para pruebas." }],
        events: [],
      };
    }

    const currentLast = this.lastVoucherByKey.get(key) ?? 0;
    if (voucherNumber !== currentLast + 1) {
      // Mirrors real ARCA's own numbering-conflict rejection (error 10016)
      // for a request whose CbteDesde no longer matches the next expected
      // number — the scenario a genuine numbering race would produce.
      return {
        outcome: "REJECTED",
        voucherNumber,
        observations: [],
        errors: [{ code: "10016", message: "El número de comprobante no se corresponde con el próximo a autorizar." }],
        events: [],
      };
    }

    const cae = `FAKECAE${String(voucherNumber).padStart(8, "0")}`;
    const caeExpiresAt = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    this.lastVoucherByKey.set(key, voucherNumber);
    this.issuedVouchers.set(`${key}:${voucherNumber}`, { cae, caeExpiresAt, totalAmount: request.ImpTotal });
    return { outcome: "APPROVED", cae, caeExpiresAt, voucherNumber, observations: [], events: [] };
  }

  async getVoucherDetail(input: WsfeLastVoucherInput & { voucherNumber: number }): Promise<WsfeVoucherDetail> {
    const issued = this.issuedVouchers.get(`${voucherKey(input.pointOfSale, input.documentTypeCode)}:${input.voucherNumber}`);
    if (!issued) return { found: false, cae: null, caeExpiresAt: null, totalAmount: null };
    return { found: true, cae: issued.cae, caeExpiresAt: issued.caeExpiresAt, totalAmount: issued.totalAmount };
  }

  async getParameterTable(): Promise<unknown> {
    return [];
  }

  // --- Testing controls only — never referenced by application code. ---
  setInitialLastVoucherForTesting(pointOfSale: number, documentTypeCode: number, value: number): void {
    this.lastVoucherByKey.set(voucherKey(pointOfSale, documentTypeCode), value);
  }
  forceNextRequestRejectedForTesting(): void {
    this.forcedNextOutcome = "REJECT";
  }
  forceNextRequestNetworkErrorForTesting(): void {
    this.forcedNextOutcome = "NETWORK_ERROR";
  }
  getRequestCaeCallCountForTesting(): number {
    return this.requestCaeCallCount;
  }
  // Simulates "ARCA actually authorized this voucher even though OUR
  // process never got to see the response" — the exact scenario
  // reconcileArcaFiscalDocument exists for. Bypasses requestCae entirely
  // (never increments requestCaeCallCount): this represents ground truth
  // on ARCA's side, independent of what our own code believes happened.
  issueVoucherDirectlyForTesting(
    pointOfSale: number,
    documentTypeCode: number,
    voucherNumber: number,
    cae: string,
    totalAmount: number,
  ): void {
    const key = voucherKey(pointOfSale, documentTypeCode);
    this.lastVoucherByKey.set(key, voucherNumber);
    this.issuedVouchers.set(`${key}:${voucherNumber}`, {
      cae,
      caeExpiresAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
      totalAmount,
    });
  }
}

let provider: ArcaElectronicInvoiceProvider | null = null;

export function getArcaElectronicInvoiceProvider(): ArcaElectronicInvoiceProvider {
  if (!provider) {
    provider = env.E2E_TEST_MODE ? new FakeArcaElectronicInvoiceProvider() : new RealArcaElectronicInvoiceProvider();
  }
  return provider;
}

export function setArcaElectronicInvoiceProviderForTesting(
  testProvider: ArcaElectronicInvoiceProvider | null,
): void {
  provider = testProvider;
}
