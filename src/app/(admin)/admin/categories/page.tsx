import Image from "next/image";
import Link from "next/link";
import { ImageOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/modules/auth";
import { listSizeGroups } from "@/modules/attributes/service";
import { getCategoryImagePublicUrl } from "@/modules/categories/category-images";
import { listCategories } from "@/modules/categories/service";

import { CategoryRowActions } from "./category-row-actions";
import { CreateCategoryDialog } from "./create-category-dialog";
import { StorefrontNavToggle } from "./storefront-nav-toggle";

export const metadata = { title: "Categorías" };

export default async function CategoriesPage() {
  const user = await requirePermission("categories.view");
  const canManage = user.permissions.has("categories.manage");

  const [categories, sizeGroups] = await Promise.all([listCategories(), listSizeGroups()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Categorías</h1>
          <p className="text-muted-foreground text-sm">
            Organizan el catálogo. Solo las que actives abajo aparecen en la navegación pública.
          </p>
        </div>
        {canManage && (
          <CreateCategoryDialog
            categories={categories.map((c) => ({ id: c.id, name: c.name }))}
            sizeGroups={sizeGroups.map((g) => ({ id: g.id, name: g.name }))}
          />
        )}
      </div>
      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Imagen</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Categoría padre</TableHead>
              <TableHead>Productos</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Navegación pública</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category) => {
              const imageUrl =
                category.imageBucket && category.imagePath
                  ? getCategoryImagePublicUrl({ imageBucket: category.imageBucket, imagePath: category.imagePath })
                  : null;

              return (
              <TableRow key={category.id}>
                <TableCell>
                  <div className="bg-muted relative size-10 shrink-0 overflow-hidden rounded-md">
                    {imageUrl ? (
                      <Image src={imageUrl} alt="" fill sizes="40px" className="object-cover" />
                    ) : (
                      <div className="text-muted-foreground flex h-full w-full items-center justify-center">
                        <ImageOff className="size-4" aria-hidden="true" />
                      </div>
                    )}
                  </div>
                </TableCell>
                <TableCell className="font-medium">
                  {canManage ? (
                    <Link href={`/admin/categories/${category.id}`} className="hover:underline">
                      {category.name}
                    </Link>
                  ) : (
                    category.name
                  )}
                </TableCell>
                <TableCell>{category.parent?.name ?? "—"}</TableCell>
                <TableCell>{category._count.products}</TableCell>
                <TableCell>
                  <Badge variant={category.isActive ? "default" : "outline"}>
                    {category.isActive ? "Activa" : "Archivada"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {canManage ? (
                    <StorefrontNavToggle
                      id={category.id}
                      checked={category.showInStorefrontNav}
                      disabled={!category.isActive}
                    />
                  ) : (
                    <Badge variant={category.showInStorefrontNav ? "default" : "outline"}>
                      {category.showInStorefrontNav ? "Visible" : "Oculta"}
                    </Badge>
                  )}
                </TableCell>
                {canManage && (
                  <TableCell>
                    {category.isActive && <CategoryRowActions id={category.id} />}
                  </TableCell>
                )}
              </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
