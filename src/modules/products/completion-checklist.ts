// Pure — no imports, no "server-only". Drives the guided-steps panel on the
// admin product detail page (the single control-center page for a product —
// see the Product Flow Stabilization Sprint). Deliberately independent of
// getVisibilityBlockers (modules/products/visibility.ts): a step here can be
// "pending" without blocking publication (stock, images — a valid product
// with neither is still publicly visible, see visibility.ts's own doc
// comment) in a way a publication blocker never is. This is progress
// guidance, never a second visibility rule.

export type ProductCompletionStepStatus = "complete" | "pending" | "attention";

export type ProductCompletionStepKey =
  | "basicInfo"
  | "categoryAndSize"
  | "variants"
  | "stock"
  | "images"
  | "publication";

export interface ProductCompletionInput {
  hasPrice: boolean;
  hasCategory: boolean;
  hasSizeGroup: boolean;
  hasVariants: boolean;
  hasStock: boolean;
  hasImages: boolean;
  isPublished: boolean;
}

export interface ProductCompletionStep {
  key: ProductCompletionStepKey;
  label: string;
  status: ProductCompletionStepStatus;
  // Plain-Spanish description of what's missing — null once complete. Never
  // a raw code/enum value; always the human sentence, per the sprint's
  // "no internal terminology" requirement.
  detail: string | null;
}

// The 6 guided steps, in the exact order and wording requested: Información
// básica, Categoría y talles, Variantes, Stock, Imágenes, Publicación. Each
// gets "complete" | "pending" (optional/not-yet-done, doesn't block
// publishing) | "attention" (required and missing — publishing will fail
// with this exact reason from getVisibilityBlockers).
export function computeProductCompletionSteps(
  input: ProductCompletionInput,
): ProductCompletionStep[] {
  return [
    {
      key: "basicInfo",
      label: "Información básica",
      status: input.hasPrice ? "complete" : "attention",
      detail: input.hasPrice ? null : "Falta cargar un precio válido.",
    },
    {
      key: "categoryAndSize",
      label: "Categoría y talles",
      status: input.hasCategory ? "complete" : "attention",
      detail: input.hasCategory
        ? input.hasSizeGroup
          ? null
          : "Sin grupo de talles asignado (opcional)."
        : "Falta asignar una categoría.",
    },
    {
      key: "variants",
      label: "Variantes",
      status: input.hasVariants ? "complete" : "attention",
      detail: input.hasVariants ? null : "No hay variantes activas.",
    },
    {
      key: "stock",
      label: "Stock",
      status: input.hasStock ? "complete" : "pending",
      detail: input.hasStock ? null : "Las variantes todavía no tienen stock cargado.",
    },
    {
      key: "images",
      label: "Imágenes",
      status: input.hasImages ? "complete" : "pending",
      detail: input.hasImages ? null : "Todavía no se subieron imágenes.",
    },
    {
      key: "publication",
      label: "Publicación",
      status: input.isPublished ? "complete" : "pending",
      detail: input.isPublished ? null : "El producto todavía no está publicado.",
    },
  ];
}
