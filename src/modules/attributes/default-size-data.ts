// Canonical reference-data definitions for the store's standard size
// groups — the single, easily-editable place to add/adjust a default group
// or option. Consumed only by modules/attributes/seed-core.ts's
// seedDefaultSizeGroups(), which creates whatever's missing and never
// touches an existing row (see that file for the exact idempotency
// contract). Codes are stable identifiers, never changed once shipped —
// renaming a code here would make the seed treat it as a brand-new group
// instead of recognizing the existing one.

export interface DefaultSizeOptionDefinition {
  code: string;
  label: string;
  sortOrder: number;
}

export interface DefaultSizeGroupDefinition {
  code: string;
  name: string;
  options: DefaultSizeOptionDefinition[];
}

function numericOptions(values: number[]): DefaultSizeOptionDefinition[] {
  return values.map((value, index) => ({
    code: String(value),
    label: String(value),
    sortOrder: index + 1,
  }));
}

export const DEFAULT_SIZE_GROUPS: DefaultSizeGroupDefinition[] = [
  {
    code: "INDUMENTARIA_LETRAS",
    name: "Indumentaria — letras",
    options: ["XS", "S", "M", "L", "XL", "XXL"].map((label, index) => ({
      code: label,
      label,
      sortOrder: index + 1,
    })),
  },
  {
    code: "PANTALONES_NUMERICOS",
    name: "Pantalones — numéricos",
    options: numericOptions([34, 36, 38, 40, 42, 44, 46, 48]),
  },
  {
    code: "JEANS_CINTURA",
    name: "Jeans — cintura",
    options: numericOptions([24, 26, 28, 30, 32, 34, 36]),
  },
  {
    code: "CALZADO_MUJER",
    name: "Calzado mujer",
    options: numericOptions([35, 36, 37, 38, 39, 40, 41]),
  },
  {
    code: "TALLE_UNICO",
    name: "Talle único",
    options: [{ code: "UNICO", label: "Único", sortOrder: 1 }],
  },
];
