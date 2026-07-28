import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requirePermission } from "@/modules/auth";
import { listProducts } from "@/modules/products/service";

export const metadata = { title: "Productos" };

const STATUS_LABELS_ES: Record<string, string> = {
  DRAFT: "Borrador",
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  ARCHIVED: "Archivado",
};

export default async function ProductsPage() {
  const user = await requirePermission("products.view");
  const canCreate = user.permissions.has("products.create");

  const products = await listProducts();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Productos</h1>
          <p className="text-muted-foreground text-sm">Catálogo de productos y variantes.</p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/admin/products/new">Nuevo producto</Link>
          </Button>
        )}
      </div>
      <div className="border-border overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Marca</TableHead>
              <TableHead>Variantes</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => (
              <TableRow key={product.id}>
                <TableCell className="font-medium">
                  <Link href={`/admin/products/${product.id}`} className="hover:underline">
                    {product.name}
                  </Link>
                </TableCell>
                <TableCell>{product.category?.name ?? "—"}</TableCell>
                <TableCell>{product.brand?.name ?? "—"}</TableCell>
                <TableCell>{product.variants.filter((v) => v.isActive).length}</TableCell>
                <TableCell>
                  <Badge variant={product.status === "ACTIVE" ? "default" : "outline"}>
                    {STATUS_LABELS_ES[product.status]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
