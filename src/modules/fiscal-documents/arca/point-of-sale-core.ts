// Pure — no "server-only", no DB import. Isolated point-of-sale validation
// rule so it's defined and tested in exactly one place, reused by the
// Server Action's Zod schema — never re-implemented inline.
//
// SOURCE: WSFEv1 "Manual para el Desarrollador" V. 4.6 (ARCA, RG 4291
// lineage — see this module's own README-equivalent in the final report for
// the exact retrieval/version details). FECAESolicitar's PtoVta field is
// validated server-side by ARCA itself as error 10004 ("Punto de Venta
// inválido") outside the range 1..99998 — a 5-digit field, not 4. Cross-
// verified via two independent sources (the official landing page's
// currently-advertised manual, plus third-party developer-documentation
// mirrors quoting the same 1..99998 bound and error code) — see the
// correction report for URLs. Previously this codebase validated 1..9999
// (4 digits) — WRONG, corrected here.
export const ARCA_POINT_OF_SALE_MIN = 1;
export const ARCA_POINT_OF_SALE_MAX = 99998;

export function isValidArcaPointOfSale(value: number): boolean {
  return Number.isInteger(value) && value >= ARCA_POINT_OF_SALE_MIN && value <= ARCA_POINT_OF_SALE_MAX;
}

// Presentation-layer ONLY — never used for the WSFEV1 request itself (PtoVta
// there is a plain integer, never zero-padded; see wsfe-request-builder-core.ts).
// This is for a future printed/displayed invoice identifier, matching the
// conventional Argentine "0001-00001234" formatting. Deliberately a MINIMUM
// width, not a fixed one: padStart never truncates, so a genuine 5-digit
// point of sale (up to 99998) still displays in full — this must never
// hard-code "always exactly 4 digits" (see this phase's explicit
// correction).
export function formatArcaPointOfSale(value: number): string {
  return String(value).padStart(4, "0");
}
