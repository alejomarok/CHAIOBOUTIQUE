import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";
import { listSizeGroups } from "@/modules/attributes/service";
import { listBrands } from "@/modules/brands/service";
import { listCategories } from "@/modules/categories/service";

import { ProductForm } from "../product-form";

export const metadata = { title: "Nuevo producto" };

export default async function NewProductPage() {
  const user = await requirePermission("products.create");

  const [categories, brands, sizeGroups] = await Promise.all([
    listCategories(),
    listBrands(),
    listSizeGroups(),
  ]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Nuevo producto</h1>
        <p className="text-muted-foreground text-sm">
          Esto solo guarda los datos básicos. Después de crear el producto vas a poder definir
          categoría, grupo de talles, variantes, stock e imágenes — las imágenes recién se pueden
          subir una vez que el producto ya existe. El producto queda en borrador y no se publica
          automáticamente.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <ProductForm
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            brands={brands.map((b) => ({ id: b.id, name: b.name }))}
            sizeGroups={sizeGroups.map((g) => ({ id: g.id, name: g.name }))}
            canViewCost={user.permissions.has("products.view_cost")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
