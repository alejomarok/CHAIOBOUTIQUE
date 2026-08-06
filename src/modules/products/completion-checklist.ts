// Pure — no imports, no "server-only". The compact "what's left before this
// product is fully set up" checklist shown on the admin product detail
// page — see required behavior "Provide a compact completion checklist."
// Deliberately independent of getVisibilityBlockers (modules/products/
// visibility.ts): a checklist step can be "optional" (size group, stock,
// images) in a way a publication blocker never is — this is progress
// guidance, not the authoritative publication rule, and never duplicates
// that rule's conditions.

export interface ProductCompletionInput {
  hasCategory: boolean;
  hasSizeGroup: boolean;
  hasPrice: boolean;
  hasVariants: boolean;
  hasStock: boolean;
  hasImages: boolean;
  isPublished: boolean;
}

export interface ProductCompletionStep {
  key: string;
  label: string;
  done: boolean;
  optional: boolean;
}

export function computeProductCompletionSteps(
  input: ProductCompletionInput,
): ProductCompletionStep[] {
  return [
    { key: "category", label: "Categoría", done: input.hasCategory, optional: false },
    { key: "sizeGroup", label: "Grupo de talles", done: input.hasSizeGroup, optional: true },
    { key: "price", label: "Precio", done: input.hasPrice, optional: false },
    { key: "variants", label: "Variantes", done: input.hasVariants, optional: false },
    { key: "stock", label: "Stock", done: input.hasStock, optional: true },
    { key: "images", label: "Imágenes", done: input.hasImages, optional: true },
    { key: "published", label: "Publicación", done: input.isPublished, optional: false },
  ];
}
