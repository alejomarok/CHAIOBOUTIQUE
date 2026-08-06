// Pure — no imports, no "server-only". The size/color selection logic
// behind components/catalog/product-variant-selector.tsx, extracted so it's
// directly unit-testable against a synthetic variant list, no DOM/DB
// involved. Mirrors modules/products/public-queries.ts's PublicVariantDTO
// shape loosely (only the fields this logic actually needs).

export interface SelectableVariant {
  id: string;
  sizeOptionId: string | null;
  sizeName: string | null;
  sizeSortOrder: number | null;
  colorId: string | null;
  colorName: string | null;
  stockStatus: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";
}

export interface SizeOption {
  id: string;
  name: string;
  sortOrder: number;
}

export interface ColorOption {
  id: string;
  name: string;
}

// Deduped, ordered by SizeOption.sortOrder — never alphabetically (would
// sort "10" before "9"). Required behavior: "Size options must be scoped to
// the product's SizeGroup and ordered by sortOrder" — scoping happens
// upstream (variants passed in are already only this product's own), this
// is the ordering half.
export function listSizeOptions(variants: SelectableVariant[]): SizeOption[] {
  const seen = new Map<string, SizeOption>();
  for (const variant of variants) {
    if (variant.sizeOptionId && variant.sizeName && !seen.has(variant.sizeOptionId)) {
      seen.set(variant.sizeOptionId, {
        id: variant.sizeOptionId,
        name: variant.sizeName,
        sortOrder: variant.sizeSortOrder ?? 0,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

// Deduped, first-appearance order (the query itself orders by
// Color.displayOrder — see public-queries.ts — so insertion order here is
// already the right order).
export function listColorOptions(variants: SelectableVariant[]): ColorOption[] {
  const seen = new Map<string, ColorOption>();
  for (const variant of variants) {
    if (variant.colorId && variant.colorName && !seen.has(variant.colorId)) {
      seen.set(variant.colorId, { id: variant.colorId, name: variant.colorName });
    }
  }
  return [...seen.values()];
}

// Required behavior: "disable combinations that do not correspond to an
// active variant." A size is available if some variant matches it together
// with whatever color is already selected (or any color, if none chosen
// yet) — symmetric with isColorAvailable below.
export function isSizeAvailable(
  variants: SelectableVariant[],
  sizeId: string,
  selectedColorId: string | null,
): boolean {
  return variants.some(
    (v) => v.sizeOptionId === sizeId && (selectedColorId === null || v.colorId === selectedColorId),
  );
}

export function isColorAvailable(
  variants: SelectableVariant[],
  colorId: string,
  selectedSizeId: string | null,
): boolean {
  return variants.some(
    (v) => v.colorId === colorId && (selectedSizeId === null || v.sizeOptionId === selectedSizeId),
  );
}

// The concrete variant (if any) matching the current size+color selection.
// Required behavior: "prevent adding a product until a concrete valid
// variant has been selected" — undefined here is exactly that "not yet
// concrete" state. For an axis-less product (no sizes, no colors), both
// selected ids are null and this matches the single axis-less variant.
export function findSelectedVariant<T extends SelectableVariant>(
  variants: T[],
  selectedSizeId: string | null,
  selectedColorId: string | null,
): T | undefined {
  return variants.find((v) => v.sizeOptionId === selectedSizeId && v.colorId === selectedColorId);
}

// The initial selection a product-detail page opens with — the first
// in-stock variant if one exists, otherwise simply the first variant (still
// lets the customer see/select an out-of-stock combination rather than
// defaulting to nothing at all).
export function pickDefaultVariant<T extends SelectableVariant>(variants: T[]): T | undefined {
  return variants.find((v) => v.stockStatus !== "OUT_OF_STOCK") ?? variants[0];
}
