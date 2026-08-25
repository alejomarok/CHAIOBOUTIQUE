// Pure — no "server-only", no DB import, no network. WSAA and WSFEv1 each
// expose two fully separate hosts (and, in the real world, separate
// certificate chains) for HOMOLOGATION (testing) vs. PRODUCTION — see this
// phase's explicit "never let a production certificate/endpoint be
// accidentally used by a local automated test" requirement.
// StoreConfiguration.arcaEnvironment is the ONLY thing that ever selects
// between these two maps; this phase additionally hard-fails server-side
// whenever it is not HOMOLOGATION before any network call is even attempted
// (see issue-electronic-invoice-core.ts's assertHomologationEnvironment).
//
// SOURCE (re-verified this phase, cross-checked against ARCA's own current
// WSAA/WSFEv1 landing pages — see arca-codes.ts's own header comment for
// the general WSFEv1 manual's version-pin discussion, V4.6 vs. the
// homologación-externa page's own linked V4.7 manual; both agree on these
// endpoint URLs and method names, which is the part this phase actually
// depends on):
//   WSAA homologation: https://wsaahomo.afip.gov.ar/ws/services/LoginCms
//   WSAA production:    https://wsaa.afip.gov.ar/ws/services/LoginCms
//   WSFEv1 homologation: https://wswhomo.afip.gov.ar/wsfev1/service.asmx
//   WSFEv1 production:   https://servicios1.afip.gov.ar/wsfev1/service.asmx
import type { ArcaEnvironment } from "@/generated/prisma/client";

export const ARCA_WSAA_URL: Record<ArcaEnvironment, string> = {
  HOMOLOGATION: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  PRODUCTION: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
};

export const ARCA_WSFE_URL: Record<ArcaEnvironment, string> = {
  HOMOLOGATION: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  PRODUCTION: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
};

// The only WSAA "service" identifier this integration ever requests a
// ticket for — WSFEv1's own service name, per ARCA's service catalog.
export const ARCA_WSAA_SERVICE_WSFE = "wsfe";
