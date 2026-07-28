import { describe, expect, it } from "vitest";

import { buildCsv, CsvParseError, parseCsv, sanitizeCsvCell } from "@/modules/imports/csv";

describe("sanitizeCsvCell", () => {
  it("prefixes a leading = with a single quote", () => {
    expect(sanitizeCsvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
  });

  it("prefixes a leading +, -, or @", () => {
    expect(sanitizeCsvCell("+1234")).toBe("'+1234");
    expect(sanitizeCsvCell("-1234")).toBe("'-1234");
    expect(sanitizeCsvCell("@SUM(A1)")).toBe("'@SUM(A1)");
  });

  it("leaves an ordinary value untouched", () => {
    expect(sanitizeCsvCell("Remera básica")).toBe("Remera básica");
    expect(sanitizeCsvCell("15000,50")).toBe("15000,50");
  });

  it("does not sanitize a minus sign that isn't leading", () => {
    expect(sanitizeCsvCell("SKU-001")).toBe("SKU-001");
  });
});

describe("buildCsv", () => {
  it("neutralizes a formula-injection payload in a generated CSV", () => {
    const csv = buildCsv(["name", "note"], [{ name: "=HYPERLINK(\"http://evil\")", note: "ok" }]);
    const dataLine = csv.split("\n")[1];
    expect(dataLine.startsWith("'=HYPERLINK") || dataLine.includes("'=HYPERLINK")).toBe(true);
    expect(dataLine).not.toMatch(/^=/);
  });

  it("quotes a cell containing a comma", () => {
    const csv = buildCsv(["name"], [{ name: "Rojo, Azul" }]);
    expect(csv.split("\n")[1]).toBe('"Rojo, Azul"');
  });

  it("round-trips through parseCsv", () => {
    const csv = buildCsv(["a", "b"], [{ a: "1", b: "two" }]);
    const rows = parseCsv(csv);
    expect(rows).toEqual([{ a: "1", b: "two" }]);
  });
});

describe("parseCsv", () => {
  it("parses a well-formed CSV into row objects", () => {
    const rows = parseCsv("legacyId,name\nCAT-1,Remeras\nCAT-2,Pantalones\n");
    expect(rows).toEqual([
      { legacyId: "CAT-1", name: "Remeras" },
      { legacyId: "CAT-2", name: "Pantalones" },
    ]);
  });

  it("throws CsvParseError on malformed CSV", () => {
    expect(() => parseCsv('a,b\n"unterminated')).toThrow(CsvParseError);
  });
});
