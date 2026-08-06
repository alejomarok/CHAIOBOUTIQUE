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
import { getVisibilityBlockers, type VisibilityBlockerCode } from "@/modules/products/visibility";

export const metadata = { title: "Productos" };

const STATUS_LABELS_ES: Record<string, string> = {
  DRAFT: "Borrador",
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  ARCHIVED: "Archivado",
};

// Short, list-row-sized labels for each getVisibilityBlockers() code — a
// presentation-only mapping keyed by the blocker's own code, never a second
// implementation of the visibility rule itself (see modules/products/
// visibility.ts, the single source of truth this reads from). NOT_ACTIVE_STATUS
// is handled separately below, using the product's actual current status
// label instead of a generic string — "Borrador" isn't accurate for an
// INACTIVE or ARCHIVED product.
const VISIBILITY_BLOCKER_SHORT_LABELS_ES: Record<
  Exclude<VisibilityBlockerCode, "NOT_ACTIVE_STATUS">,
  string
> = {
  NO_CATEGORY: "Sin categoría",
  NO_ACTIVE_VARIANTS: "Sin variante activa",
  VARIANT_MISSING_PRICE: "Sin precio válido",
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
              <TableHead>Visibilidad pública</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => {
              // Same single rule /catalog and /product/[slug] use — see
              // DATABASE.md "Public visibility". Never re-implemented here.
              const blockers = getVisibilityBlockers(product, product.variants);
              const isPublic = blockers.length === 0;

              return (
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
                  <TableCell>
                    {isPublic ? (
                      <Badge>Público</Badge>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {blockers.map((blocker) => (
                          <Badge key={blocker.code} variant="outline" className="text-xs">
                            {blocker.code === "NOT_ACTIVE_STATUS"
                              ? STATUS_LABELS_ES[product.status]
                              : VISIBILITY_BLOCKER_SHORT_LABELS_ES[blocker.code]}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
