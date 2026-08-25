// Node-safe core: no "server-only" import — transitively pulls in
// wsaa-core.ts's fs/network/signing, so (like that module) this only ever
// runs in a real Node process. Real WSAA implementation — see this phase's
// "REAL WSAA + WSFEv1 INTEGRATION" scope: TRA building (wsaa-tra-core.ts),
// CMS signing (wsaa-core.ts), calling the real HOMOLOGATION endpoint, and
// an in-process ticket cache (wsaa-ticket-cache-core.ts) with clock-skew
// handling and single-flight concurrency dedup.
import { env } from "@/lib/env-core";
import { getStoreConfiguration } from "@/modules/store-settings/service-core";

import { requestArcaAccessTicket } from "./wsaa-core";
import { ARCA_WSAA_SERVICE_WSFE } from "./endpoints-core";
import { arcaTicketCache } from "./wsaa-ticket-cache-core";

export class ArcaAuthNotConfiguredError extends Error {
  constructor() {
    super("La autenticación con ARCA (WSAA) todavía no está configurada.");
    this.name = "ArcaAuthNotConfiguredError";
  }
}

// Server-side hard-fail — see this phase's explicit "never rely on the UI
// hiding a button; the server must refuse to issue in PRODUCTION" rule.
// Thrown before any certificate/network access is even attempted, so a
// misconfigured or changed StoreConfiguration.arcaEnvironment can never
// result in a real production WSAA call from this codebase, which this
// phase never implements the production posture for (no production
// watermark, no production disclaimer copy, no production acceptance
// procedure — see the final report's explicit HOMOLOGATION-only scope).
export class ArcaEnvironmentNotHomologationError extends Error {
  constructor() {
    super("Esta versión solo permite operar con ARCA en el entorno de Homologación.");
    this.name = "ArcaEnvironmentNotHomologationError";
  }
}

export interface ArcaAuthTicket {
  token: string;
  sign: string;
  expiresAt: Date;
}

export interface ArcaAuthProvider {
  getToken(service: "wsfe"): Promise<ArcaAuthTicket>;
}

export class RealArcaAuthProvider implements ArcaAuthProvider {
  async getToken(): Promise<ArcaAuthTicket> {
    const config = await getStoreConfiguration();
    if (config.arcaEnvironment !== "HOMOLOGATION") {
      throw new ArcaEnvironmentNotHomologationError();
    }

    return arcaTicketCache.getValidTicket(async () => {
      const response = await requestArcaAccessTicket("HOMOLOGATION", ARCA_WSAA_SERVICE_WSFE);
      // Never logged — only the object is returned/cached; see
      // wsaa-ticket-cache-core.ts's own "never logs Token/Sign" note.
      return { token: response.token, sign: response.sign, expiresAt: response.expirationTime };
    });
  }
}

export class FakeArcaAuthProvider implements ArcaAuthProvider {
  async getToken(): Promise<ArcaAuthTicket> {
    return {
      token: "FAKE-ARCA-TOKEN-TEST-ONLY",
      sign: "FAKE-ARCA-SIGN-TEST-ONLY",
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000),
    };
  }
}

let provider: ArcaAuthProvider | null = null;

export function getArcaAuthProvider(): ArcaAuthProvider {
  if (!provider) {
    // Mirrors every other provider singleton in this directory — Fake only
    // under E2E_TEST_MODE; real Node-context integration tests inject a
    // Fake explicitly via setArcaAuthProviderForTesting instead of relying
    // on this env check (see tests/integration's own beforeEach convention).
    provider = env.E2E_TEST_MODE ? new FakeArcaAuthProvider() : new RealArcaAuthProvider();
  }
  return provider;
}

export function setArcaAuthProviderForTesting(testProvider: ArcaAuthProvider | null): void {
  provider = testProvider;
}
