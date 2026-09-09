import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";
import { listSizeGroups } from "@/modules/attributes/service";
import { getCategoryImagePublicUrl } from "@/modules/categories/category-images";
import { getCategoryById, listCategories } from "@/modules/categories/service";

import { CategoryImageManager } from "../category-image-manager";
import { EditCategoryForm } from "./edit-category-form";

export const metadata = { title: "Editar categoría" };

export default async function CategoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("categories.view");
  const canManage = user.permissions.has("categories.manage");
  const { id } = await params;

  const category = await getCategoryById(id);
  if (!category) notFound();

  const [allCategories, sizeGroups] = await Promise.all([listCategories(), listSizeGroups()]);
  // Never offer the category as its own parent — the real, arbitrary-depth
  // cycle check still runs server-side in updateCategory (see
  // modules/categories/service-core.ts's wouldCreateCycle); this is just a
  // trivial, obvious case worth not even offering in the picker.
  const parentOptions = allCategories.filter((c) => c.id !== category.id);

  const currentImageUrl =
    category.imageBucket && category.imagePath
      ? getCategoryImagePublicUrl({ imageBucket: category.imageBucket, imagePath: category.imagePath })
      : null;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/admin/categories" className="text-muted-foreground text-sm hover:underline">
          ← Categorías
        </Link>
        <h1 className="font-heading mt-1 text-2xl font-semibold">{category.name}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos de la categoría</CardTitle>
        </CardHeader>
        <CardContent>
          <EditCategoryForm
            category={{
              id: category.id,
              name: category.name,
              description: category.description ?? "",
              parentId: category.parentId ?? "",
              defaultSizeGroupId: category.defaultSizeGroupId ?? "",
              showInStorefrontNav: category.showInStorefrontNav,
            }}
            parentOptions={parentOptions.map((c) => ({ id: c.id, name: c.name }))}
            sizeGroups={sizeGroups.map((g) => ({ id: g.id, name: g.name }))}
            canManage={canManage}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Imagen de categoría</CardTitle>
        </CardHeader>
        <CardContent>
          <CategoryImageManager
            categoryId={category.id}
            currentImageUrl={currentImageUrl}
            currentAltText={category.imageAltText}
            canManage={canManage}
          />
        </CardContent>
      </Card>
    </div>
  );
}
