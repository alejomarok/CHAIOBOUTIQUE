"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { displayToMinorUnits, InvalidMoneyInputError } from "@/lib/money";
import { requirePermission } from "@/modules/auth";
import {
  createProduct,
  createVariants,
  deactivateVariant,
  setProductStatus,
  updateProduct,
} from "@/modules/products/service";

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

const productFieldsSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio"),
  internalCode: z.string().optional(),
  shortDescription: z.string().optional(),
  description: z.string().optional(),
  categoryId: z.string().optional(),
  brandId: z.string().optional(),
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

  await updateProduct(
    id,
    {
      name: data.name,
      internalCode: data.internalCode || null,
      shortDescription: data.shortDescription || null,
      description: data.description || null,
      categoryId: data.categoryId || null,
      brandId: data.brandId || null,
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
  await setProductStatus(data.id, data.status, actor.id);
  revalidatePath(`/admin/products/${data.id}`);
  revalidatePath("/admin/products");
}

const createVariantsSchema = z.object({
  productId: z.string().min(1),
  variants: z.array(
    z.object({
      sizeId: z.string().nullable(),
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
      sizeId: variant.sizeId,
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
}

export async function deactivateVariantAction(input: { variantId: string; productId: string }) {
  const actor = await requirePermission("products.edit");
  await deactivateVariant(input.variantId, actor.id);
  revalidatePath(`/admin/products/${input.productId}`);
}
