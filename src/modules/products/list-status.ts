import {
  getVisibilityBlockers,
  type VisibilityProductInput,
  type VisibilityVariantInput,
} from "./visibility";

// A single, plain-Spanish operational status per product for the admin list
// — built entirely on top of getVisibilityBlockers (the one source of truth
// for public-catalog visibility, see visibility.ts's own doc comment).
// Never a second visibility rule: every branch below is just a label over
// the exact same blockers /catalog and /product/[slug] already enforce,
// plus totalStock (which is informational, never a blocker — an
// out-of-stock product stays public, per visibility.ts's own documented
// policy).
export type ProductListStatus =
  | "DRAFT_INCOMPLETE"
  | "READY_TO_PUBLISH"
  | "PUBLISHED"
  | "OUT_OF_STOCK"
  | "BLOCKED";

export interface ProductListStatusResult {
  status: ProductListStatus;
  label: string;
}

export function computeProductListStatus(
  product: VisibilityProductInput,
  variants: readonly VisibilityVariantInput[],
  totalStock: number,
): ProductListStatusResult {
  const blockers = getVisibilityBlockers(product, variants);
  const nonStatusBlockers = blockers.filter((b) => b.code !== "NOT_ACTIVE_STATUS");
  const isActive = product.status === "ACTIVE";

  if (isActive && blockers.length === 0) {
    return totalStock > 0
      ? { status: "PUBLISHED", label: "Publicado" }
      : { status: "OUT_OF_STOCK", label: "Sin stock" };
  }

  // Was (or still is) ACTIVE, but something independent of the status
  // itself now blocks it — e.g. its only active variant was deactivated,
  // or lost its price, after the product was published.
  if (isActive && nonStatusBlockers.length > 0) {
    return { status: "BLOCKED", label: "Bloqueado" };
  }

  if (!isActive && nonStatusBlockers.length === 0) {
    return { status: "READY_TO_PUBLISH", label: "Listo para publicar" };
  }

  return { status: "DRAFT_INCOMPLETE", label: "Borrador — faltan datos" };
}
