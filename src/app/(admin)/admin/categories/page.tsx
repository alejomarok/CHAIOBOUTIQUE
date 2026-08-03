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
import { listCategories } from "@/modules/categories/service";

import { CategoryRowActions } from "./category-row-actions";
import { CreateCategoryDialog } from "./create-category-dialog";

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
            Organizan el catálogo. Pueden formar una jerarquía.
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
              <TableHead>Nombre</TableHead>
              <TableHead>Categoría padre</TableHead>
              <TableHead>Productos</TableHead>
              <TableHead>Estado</TableHead>
              {canManage && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((category) => (
              <TableRow key={category.id}>
                <TableCell className="font-medium">{category.name}</TableCell>
                <TableCell>{category.parent?.name ?? "—"}</TableCell>
                <TableCell>{category._count.products}</TableCell>
                <TableCell>
                  <Badge variant={category.isActive ? "default" : "outline"}>
                    {category.isActive ? "Activa" : "Archivada"}
                  </Badge>
                </TableCell>
                {canManage && (
                  <TableCell>
                    {category.isActive && <CategoryRowActions id={category.id} />}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
