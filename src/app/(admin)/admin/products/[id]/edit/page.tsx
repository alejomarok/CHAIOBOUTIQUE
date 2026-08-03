import { notFound } from "next/navigation";

import { minorUnitsToDisplay } from "@/lib/money";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";
import { listSizeGroups } from "@/modules/attributes/service";
import { listBrands } from "@/modules/brands/service";
import { listCategories } from "@/modules/categories/service";
import { getProductById } from "@/modules/products/service";

import { ProductForm } from "../../product-form";

export const metadata = { title: "Editar producto" };

// The form has no "leave untouched" option once a product exists (see
// product-form.tsx's NO_SIZE_GROUP sentinel and actions.ts's
// resolveSizeGroupIdInput) — a size-less product's field must render as the
// explicit "Sin grupo de talles" option, never blank/placeholder, or saving
// the form unchanged would be misread as "propose from category" on an
// update, which is not this form's contract.
const NO_SIZE_GROUP = "__none__";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("products.edit");
  const { id } = await params;

  const [product, categories, brands, sizeGroups] = await Promise.all([
    getProductById(id),
    listCategories(),
    listBrands(),
    listSizeGroups(),
  ]);
  if (!product) notFound();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Editar producto</h1>
        <p className="text-muted-foreground text-sm">{product.name}</p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <ProductForm
            productId={product.id}
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            brands={brands.map((b) => ({ id: b.id, name: b.name }))}
            sizeGroups={sizeGroups.map((g) => ({ id: g.id, name: g.name }))}
            canViewCost={user.permissions.has("products.view_cost")}
            defaultValues={{
              name: product.name,
              internalCode: product.internalCode ?? "",
              shortDescription: product.shortDescription ?? "",
              description: product.description ?? "",
              categoryId: product.categoryId ?? "",
              brandId: product.brandId ?? "",
              sizeGroupId: product.sizeGroupId ?? NO_SIZE_GROUP,
              seoTitle: product.seoTitle ?? "",
              seoDescription: product.seoDescription ?? "",
              defaultPriceAmount:
                product.defaultPriceAmount !== null
                  ? minorUnitsToDisplay(product.defaultPriceAmount).replace(/[^\d,.-]/g, "")
                  : "",
              compareAtPriceAmount:
                product.compareAtPriceAmount !== null
                  ? minorUnitsToDisplay(product.compareAtPriceAmount).replace(/[^\d,.-]/g, "")
                  : "",
              referenceCostAmount:
                product.referenceCostAmount !== null
                  ? minorUnitsToDisplay(product.referenceCostAmount).replace(/[^\d,.-]/g, "")
                  : "",
              minimumStockThreshold:
                product.minimumStockThreshold !== null ? String(product.minimumStockThreshold) : "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
