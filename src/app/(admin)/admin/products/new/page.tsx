import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";
import { listBrands } from "@/modules/brands/service";
import { listCategories } from "@/modules/categories/service";

import { ProductForm } from "../product-form";

export const metadata = { title: "Nuevo producto" };

export default async function NewProductPage() {
  const user = await requirePermission("products.create");

  const [categories, brands] = await Promise.all([listCategories(), listBrands()]);

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Nuevo producto</h1>
        <p className="text-muted-foreground text-sm">
          Después de crearlo vas a poder agregar talles, colores y variantes.
        </p>
      </div>
      <Card>
        <CardContent className="pt-6">
          <ProductForm
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            brands={brands.map((b) => ({ id: b.id, name: b.name }))}
            canViewCost={user.permissions.has("products.view_cost")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
