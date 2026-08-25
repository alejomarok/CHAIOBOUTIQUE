-- Phase: ARCA Homologation — Real WSAA + WSFEv1 Integration.
-- Adds the fields the real issueElectronicInvoice()/reconcileArcaFiscalDocument()
-- flow (modules/fiscal-documents/arca/issue-electronic-invoice-core.ts)
-- needs to persist ARCA's own response beyond the pre-existing cae/caeExpiresAt
-- columns. All nullable — every existing row (and every MANUAL/SISTEMA_EXTERNO
-- row, forever) simply leaves these null. Create-only, additive, never touches
-- an existing column or row.
--
-- arcaEnvironment: which environment (always HOMOLOGATION this phase) a
--   specific document was actually issued under — the authoritative source
--   for the mandatory "HOMOLOGACIÓN" watermark in the admin UI.
-- exemptAmount: the exempt-amount half of the fiscal decomposition (see
--   tax-calculation-core.ts's FiscalCalculationResult.exemptAmount),
--   alongside the pre-existing netAmount/taxAmount columns.
-- arcaTaxBreakdown: the resolved per-VAT-rate breakdown actually sent to and
--   authorized by ARCA (amounts as decimal strings — JSON has no BigInt type;
--   audit/display detail only, never an authority — netAmount/taxAmount stay
--   authoritative).
-- arcaResponseMetadata: a safe subset of ARCA's own FECAESolicitar/
--   FECompConsultar response (result, observations, errors, events) — never
--   Token/Sign, never the full raw SOAP payload.

-- AlterTable
ALTER TABLE "fiscal_document" ADD COLUMN     "arcaEnvironment" "ArcaEnvironment",
ADD COLUMN     "arcaResponseMetadata" JSONB,
ADD COLUMN     "arcaTaxBreakdown" JSONB,
ADD COLUMN     "exemptAmount" BIGINT;
