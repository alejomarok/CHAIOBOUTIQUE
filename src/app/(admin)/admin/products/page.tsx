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
import { getStockByVariantIds } from "@/modules/inventory/service";
import { computeProductListStatus, type ProductListStatus } from "@/modules/products/list-status";
import { listProducts } from "@/modules/products/service";
import { isPubliclyVisible } from "@/modules/products/visibility";

import { ProductStatusActions } from "./[id]/product-status-actions";

export const metadata = { title: "Productos" };

// Presentation-only badge color per computeProductListStatus's result — the
// status decision itself lives in modules/products/list-status.ts, never
// here.
const STATUS_BADGE_VARIANT: Record<ProductListStatus, "default" | "outline" | "secondary"> = {
  PUBLISHED: "default",
  READY_TO_PUBLISH: "secondary",
  OUT_OF_STOCK: "outline",
  BLOCKED: "outline",
  DRAFT_INCOMPLETE: "outline",
};

export default async function ProductsPage() {
  const user = await requirePermission("products.view");
  const canCreate = user.permissions.has("products.create");
  const canPublish = user.permissions.has("products.publish");
  const canArchive = user.permissions.has("products.archive");

  const products = await listProducts();

  // One batched query for every variant across the whole list — never one
  // stock lookup per row (see getStockByVariantIds's own doc comment).
  const allVariantIds = products.flatMap((p) => p.variants.map((v) => v.id));
  const stockByVariantId = await getStockByVariantIds(allVariantIds);

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
      <div className="border-border overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Marca</TableHead>
              <TableHead>Variantes</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => {
              const activeVariants = product.variants.filter((v) => v.isActive);
              const totalStock = product.variants.reduce(
                (sum, v) => sum + (stockByVariantId.get(v.id) ?? 0),
                0,
              );
              // Same single rule /catalog and /product/[slug] use — see
              // modules/products/visibility.ts, the source of truth both
              // this and computeProductListStatus read from. Never
              // re-implemented here.
              const isPublic = isPubliclyVisible(product, product.variants);
              const { status: listStatus, label: statusLabel } = computeProductListStatus(
                product,
                product.variants,
                totalStock,
              );

              return (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">
                    <Link href={`/admin/products/${product.id}`} className="hover:underline">
                      {product.name}
                    </Link>
                  </TableCell>
                  <TableCell>{product.category?.name ?? "—"}</TableCell>
                  <TableCell>{product.brand?.name ?? "—"}</TableCell>
                  <TableCell>{activeVariants.length}</TableCell>
                  <TableCell>{totalStock}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE_VARIANT[listStatus]}>{statusLabel}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/admin/products/${product.id}`}>Ver</Link>
                      </Button>
                      <Button asChild size="sm" variant="outline">
                        <Link href={`/admin/products/${product.id}/edit`}>Editar</Link>
                      </Button>
                      <ProductStatusActions
                        productId={product.id}
                        status={product.status}
                        canPublish={canPublish}
                        canArchive={canArchive}
                      />
                      {isPublic && (
                        <Button asChild size="sm" variant="ghost">
                          <Link href={`/product/${product.slug}`} target="_blank">
                            Ver en la tienda ↗
                          </Link>
                        </Button>
                      )}
                    </div>
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
