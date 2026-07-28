import { notFound } from "next/navigation";

import { minorUnitsToDisplay } from "@/lib/money";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";
import { listBrands } from "@/modules/brands/service";
import { listCategories } from "@/modules/categories/service";
import { getProductById } from "@/modules/products/service";

import { ProductForm } from "../../product-form";

export const metadata = { title: "Editar producto" };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("products.edit");
  const { id } = await params;

  const [product, categories, brands] = await Promise.all([
    getProductById(id),
    listCategories(),
    listBrands(),
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
            canViewCost={user.permissions.has("products.view_cost")}
            defaultValues={{
              name: product.name,
              internalCode: product.internalCode ?? "",
              shortDescription: product.shortDescription ?? "",
              description: product.description ?? "",
              categoryId: product.categoryId ?? "",
              brandId: product.brandId ?? "",
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
