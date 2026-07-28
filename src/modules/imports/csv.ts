import { parse } from "csv-parse/sync";

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

// OWASP-documented mitigation against formula injection: a cell opened by a
// spreadsheet application (Excel, Sheets, LibreOffice) that starts with
// =, +, -, or @ is interpreted as a formula. Prefixing with a single quote
// forces it to render as literal text instead. Applied to every generated
// CSV (templates, error reports) — never to values before they're used for
// anything other than a CSV cell.
export function sanitizeCsvCell(value: string): string {
  if (/^[=+\-@]/.test(value)) return `'${value}`;
  return value;
}

export type CsvRow = Record<string, string>;

// Synchronous parse: import files are expected to be small enough (a few
// thousand rows) to fit comfortably in memory for this phase — see
// DATABASE.md "Migration readiness" for the documented scale assumption.
export function parseCsv(fileContents: string | Buffer): CsvRow[] {
  try {
    return parse(fileContents, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as CsvRow[];
  } catch (error) {
    throw new CsvParseError(error instanceof Error ? error.message : "No se pudo leer el CSV.");
  }
}

// Builds a downloadable CSV from an array of plain objects — used for both
// the blank import template (rows = [] or one example row) and the
// post-import error report. Every cell goes through sanitizeCsvCell.
export function buildCsv(headers: string[], rows: Array<Record<string, string>>): string {
  const lines = [headers.map(sanitizeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(
      headers
        .map((header) => {
          const raw = row[header] ?? "";
          const sanitized = sanitizeCsvCell(raw);
          // Quote any cell containing a comma, quote, or newline — standard
          // CSV escaping, applied after the injection-safety prefix so the
          // leading single quote is part of the quoted content.
          return /[",\n]/.test(sanitized) ? `"${sanitized.replace(/"/g, '""')}"` : sanitized;
        })
        .join(","),
    );
  }
  return lines.join("\n");
}
