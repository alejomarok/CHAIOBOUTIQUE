// Node-safe core: no "server-only" import. Section 9's "Probar conexión
// con ARCA" admin action: verifies WSAA authentication + WSFEv1
// connectivity end-to-end WITHOUT ever creating a FiscalDocument/CAE — see
// this phase's explicit "never create a FiscalDocument" requirement for
// this specific action.
import { getStoreConfiguration } from "@/modules/store-settings/service-core";

import { getArcaAuthProvider } from "./auth-provider-core";
import { ARCA_CBTE_TIPO_CODE } from "./arca-codes";
import { getArcaElectronicInvoiceProvider, type WsfeDummyResult } from "./electronic-invoice-provider-core";
import { getArcaConnectionReadiness, getArcaDataReadiness } from "./readiness-core";

export class ArcaConnectionNotReadyError extends Error {
  constructor(blockerMessages: string[]) {
    super(`No se puede probar la conexión con ARCA: ${blockerMessages.join(" ")}`);
    this.name = "ArcaConnectionNotReadyError";
  }
}

export interface ArcaConnectionProbeResult {
  dummy: WsfeDummyResult;
  authenticated: true;
  pointOfSale: number;
  // The last authorized voucher ARCA reports for a harmless probe document
  // type (Factura C) at the configured point of sale — proves the full
  // WSAA-ticket + WSFEv1-authenticated-call path works, without requesting
  // a CAE or resolving a real Sale's own document type.
  lastAuthorizedVoucherFacturaC: number;
}

export async function probeArcaConnection(): Promise<ArcaConnectionProbeResult> {
  const [dataReadiness, connectionReadiness, config] = await Promise.all([
    getArcaDataReadiness(),
    getArcaConnectionReadiness(),
    getStoreConfiguration(),
  ]);

  const blockers = [...dataReadiness.blockers, ...connectionReadiness.blockers];
  if (blockers.length > 0) {
    throw new ArcaConnectionNotReadyError(blockers.map((blocker) => blocker.message));
  }

  // Both readiness checks passed, so these are guaranteed non-null —
  // narrowed here rather than re-validated, to keep this function's own
  // logic focused on the actual probe.
  const pointOfSale = config.arcaPointOfSale!;
  const cuit = config.fiscalTaxId!;

  const invoiceProvider = getArcaElectronicInvoiceProvider();
  const dummy = await invoiceProvider.dummy();

  const authProvider = getArcaAuthProvider();
  const ticket = await authProvider.getToken("wsfe");

  const lastAuthorizedVoucherFacturaC = await invoiceProvider.getLastAuthorizedVoucher(
    { pointOfSale, documentTypeCode: ARCA_CBTE_TIPO_CODE.FACTURA_C },
    ticket,
    cuit,
  );

  return { dummy, authenticated: true, pointOfSale, lastAuthorizedVoucherFacturaC };
}
