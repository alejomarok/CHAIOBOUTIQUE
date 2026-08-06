"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { displayToMinorUnits, InvalidMoneyInputError } from "@/lib/money";
import { requirePermission } from "@/modules/auth";
import {
  createProduct,
  createVariants,
  deactivateVariant,
  getProductById,
  setProductStatus,
  updateProduct,
} from "@/modules/products/service";
import { getVisibilityBlockers, type VisibilityBlocker } from "@/modules/products/visibility";

const moneyField = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return null;
    try {
      return displayToMinorUnits(value);
    } catch (error) {
      if (error instanceof InvalidMoneyInputError) {
        ctx.addIssue({ code: "custom", message: "Monto inválido" });
        return z.NEVER;
      }
      throw error;
    }
  });

// "" (unset/placeholder — the client never sends this deliberately, only
// as the field's default/untouched state): create -> propose from
// Category.defaultSizeGroupId, update -> leave the current value
// untouched. "__none__": an explicit "no size group" override. Anything
// else: an explicit chosen SizeGroup id. See
// modules/products/service.ts's CreateProductInput/UpdateProductInput for
// the same three-state contract at the service layer.
const NO_SIZE_GROUP = "__none__";

function resolveSizeGroupIdInput(value: string | undefined): string | null | undefined {
  if (value === NO_SIZE_GROUP) return null;
  return value || undefined;
}

const productFieldsSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  internalCode: z.string().optional(),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
  sizeGroupId: z.string().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
  defaultPriceAmount: moneyField,
  compareAtPriceAmount: moneyField,
  referenceCostAmount: moneyField,
  minimumStockThreshold: z.number().int().nonnegative().optional(),
});

export async function createProductAction(input: z.input<typeof productFieldsSchema>) {
  const actor = await requirePermission("products.create");
  const data = productFieldsSchema.parse(input);

  // Cost is only ever accepted from a caller who can see it — even though
  // the admin UI already hides the field, the server re-checks
  // independently (never trust that the client honored the same rule).
  const canSetCost = actor.permissions.has("products.view_cost");

  const product = await createProduct(
    {
      name: data.name,
      internalCode: data.internalCode || null,
      shortDescription: data.shortDescription || null,
      description: data.description || null,
      categoryId: data.categoryId || null,
      brandId: data.brandId || null,
      sizeGroupId: resolveSizeGroupIdInput(data.sizeGroupId),
      seoTitle: data.seoTitle || null,
      seoDescription: data.seoDescription || null,
      defaultPriceAmount: data.defaultPriceAmount,
      compareAtPriceAmount: data.compareAtPriceAmount,
      referenceCostAmount: canSetCost ? data.referenceCostAmount : null,
      minimumStockThreshold: data.minimumStockThreshold ?? null,
    },
    actor.id,
  );

  revalidatePath("/admin/products");
  return { id: product.id };
}

export async function updateProductAction(id: string, input: z.input<typeof productFieldsSchema>) {
  const actor = await requirePermission("products.edit");
  const data = productFieldsSchema.parse(input);
  const canSetCost = actor.permissions.has("products.view_cost");

  const product = await updateProduct(
    id,
    {
      name: data.name,
      internalCode: data.internalCode || null,
      shortDescription: data.shortDescription || null,
      description: data.description || null,
      categoryId: data.categoryId || null,
      brandId: data.brandId || null,
      sizeGroupId: resolveSizeGroupIdInput(data.sizeGroupId),
      seoTitle: data.seoTitle || null,
      seoDescription: data.seoDescription || null,
      defaultPriceAmount: data.defaultPriceAmount,
      compareAtPriceAmount: data.compareAtPriceAmount,
      ...(canSetCost ? { referenceCostAmount: data.referenceCostAmount } : {}),
      minimumStockThreshold: data.minimumStockThreshold ?? null,
    },
    actor.id,
  );

  revalidatePath(`/admin/products/${id}`);
  revalidatePath(`/admin/products/${id}/edit`);
  // A previously-published product can change name/price/category here —
  // all of it public-facing. See DATABASE.md "Public visibility".
  revalidatePath("/catalog");
  revalidatePath(`/product/${product.slug}`);
}

const statusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]),
});

export async function setProductStatusAction(input: z.infer<typeof statusSchema>) {
  const actor = await requirePermission(
    input.status === "ARCHIVED" ? "products.archive" : "products.publish",
  );
  const data = statusSchema.parse(input);
  const product = await setProductStatus(data.id, data.status, actor.id);
  revalidatePath(`/admin/products/${data.id}`);
  revalidatePath("/admin/products");
  // This is the mutation that most directly flips public visibility
  // (DRAFT/INACTIVE/ARCHIVED <-> ACTIVE) — see DATABASE.md "Public
  // visibility". /catalog is dynamically rendered per-request (it reads
  // searchParams) so this is defense in depth, not the only thing making
  // a status change show up; /product/[slug] has no such dynamic API and
  // is the one that actually needs this to avoid serving a stale cached
  // response.
  revalidatePath("/catalog");
  revalidatePath(`/product/${product.slug}`);
}

const createVariantsSchema = z.object({
  productId: z.string().min(1),
  variants: z.array(
    z.object({
      sizeOptionId: z.string().nullable(),
      colorId: z.string().nullable(),
      sku: z.string().min(1, "El SKU es obligatorio"),
      barcode: z.string().optional(),
      priceAmount: moneyField,
      compareAtPriceAmount: moneyField,
      costAmount: moneyField,
    }),
  ),
});

export async function createVariantsAction(input: z.input<typeof createVariantsSchema>) {
  const actor = await requirePermission("products.edit");
  const data = createVariantsSchema.parse(input);
  const canSetCost = actor.permissions.has("products.view_cost");

  await createVariants(
    data.productId,
    data.variants.map((variant) => ({
      sizeOptionId: variant.sizeOptionId,
      colorId: variant.colorId,
      sku: variant.sku,
      barcode: variant.barcode || null,
      priceAmount: variant.priceAmount,
      compareAtPriceAmount: variant.compareAtPriceAmount,
      costAmount: canSetCost ? variant.costAmount : null,
    })),
    actor.id,
  );

  revalidatePath(`/admin/products/${data.productId}`);
  // A product can already be ACTIVE when new variants are added to it
  // (e.g. restocking a new size) — see DATABASE.md "Public visibility".
  revalidatePath("/catalog");
}

export interface PublishProductResult {
  status: "published" | "blocked";
  blockers: VisibilityBlocker[];
}

// The explicit "Publicar" action — validates every public-visibility
// requirement server-side, in one pass, via the single source of truth
// (modules/products/visibility.ts's getVisibilityBlockers), and returns
// ALL of them at once rather than failing on the first one. Never partially
// publishes: if anything is missing, the product's status is left
// untouched and every blocker is returned for the UI to display together.
export async function publishProductAction(productId: string): Promise<PublishProductResult> {
  const actor = await requirePermission("products.publish");
  const product = await getProductById(productId);
  if (!product) throw new Error("Producto no encontrado.");

  // Checked as if status were already ACTIVE, then NOT_ACTIVE_STATUS is
  // filtered out — that specific blocker is trivially true for anything
  // not yet published (it's exactly what this action is about to fix), so
  // reporting it back as a "reason it can't publish" would be circular and
  // uninformative. Every other blocker (category, active variants, valid
  // price) is real, independent missing data.
  const blockers = getVisibilityBlockers(
    {
      status: "ACTIVE",
      categoryId: product.categoryId,
      defaultPriceAmount: product.defaultPriceAmount,
    },
    product.variants,
  ).filter((blocker) => blocker.code !== "NOT_ACTIVE_STATUS");

  if (blockers.length > 0) {
    return { status: "blocked", blockers };
  }

  const updated = await setProductStatus(productId, "ACTIVE", actor.id);
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath("/admin/products");
  revalidatePath("/catalog");
  revalidatePath(`/product/${updated.slug}`);
  return { status: "published", blockers: [] };
}

export async function deactivateVariantAction(input: { variantId: string; productId: string }) {
  const actor = await requirePermission("products.edit");
  await deactivateVariant(input.variantId, actor.id);
  revalidatePath(`/admin/products/${input.productId}`);
  // Deactivating a product's only remaining variant can flip its public
  // visibility off — see DATABASE.md "Public visibility".
  revalidatePath("/catalog");
}
