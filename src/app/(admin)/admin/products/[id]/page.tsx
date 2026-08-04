import Link from "next/link";
import { notFound } from "next/navigation";

import { minorUnitsToDisplay } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";
import { listSizeOptions, listColors } from "@/modules/attributes/service";
import { getTotalStockForVariants } from "@/modules/inventory/service";
import { getProductImagePublicUrl } from "@/modules/products/product-images";
import { getProductById } from "@/modules/products/service";
import { getVisibilityBlockers } from "@/modules/products/visibility";

import { ProductImagesManager } from "./product-images-manager";
import { ProductStatusActions } from "./product-status-actions";
import { VariantManager } from "./variant-manager";

const STATUS_LABELS_ES: Record<string, string> = {
  DRAFT: "Borrador",
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  ARCHIVED: "Archivado",
};

export const metadata = { title: "Detalle de producto" };

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("products.view");
  const { id } = await params;

  const [product, colors] = await Promise.all([getProductById(id), listColors()]);
  if (!product) notFound();

  // Required behavior #3: the variant matrix only ever offers options from
  // the product's own SizeGroup, never the full catalog — a size-less
  // product (no sizeGroupId) gets an empty list, not every size that
  // exists anywhere.
  const sizeOptions = product.sizeGroupId ? await listSizeOptions(product.sizeGroupId) : [];

  const activeVariants = product.variants.filter((v) => v.isActive);
  const totalStock = await getTotalStockForVariants(activeVariants.map((v) => v.id));
  // See DATABASE.md "Public visibility" — this is the exact, single rule
  // both /catalog and /product/[slug] use, surfaced here so an admin never
  // has to guess why a product isn't showing up publicly.
  const visibilityBlockers = getVisibilityBlockers(product, product.variants);
  const isPubliclyVisible = visibilityBlockers.length === 0;

  const canViewCost = user.permissions.has("products.view_cost");
  const canEdit = user.permissions.has("products.edit");
  const canManageImages = user.permissions.has("product_images.manage");

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">{product.name}</h1>
          <div className="mt-1 flex items-center gap-2">
            <Badge variant={product.status === "ACTIVE" ? "default" : "outline"}>
              {STATUS_LABELS_ES[product.status]}
            </Badge>
            {product.category && (
              <span className="text-muted-foreground text-sm">{product.category.name}</span>
            )}
            {product.sizeGroup && (
              <span className="text-muted-foreground text-sm">
                Talles: {product.sizeGroup.name}
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <Button asChild variant="outline">
              <Link href={`/admin/products/${product.id}/edit`}>Editar</Link>
            </Button>
          )}
          <ProductStatusActions
            productId={product.id}
            status={product.status}
            canPublish={user.permissions.has("products.publish")}
            canArchive={user.permissions.has("products.archive")}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Visibilidad pública</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Badge variant={isPubliclyVisible ? "default" : "outline"}>
              {isPubliclyVisible ? "Visible en la tienda" : "No visible en la tienda"}
            </Badge>
            {isPubliclyVisible && (
              <Link
                href={`/product/${product.slug}`}
                target="_blank"
                className="text-muted-foreground text-xs hover:underline"
              >
                Ver en la tienda ↗
              </Link>
            )}
          </div>
          {!isPubliclyVisible && (
            <div className="border-border bg-muted/40 rounded-lg border p-3">
              <p className="mb-1.5 text-sm font-medium">Por qué no aparece en /catalog:</p>
              <ul className="text-muted-foreground list-inside list-disc text-sm">
                {visibilityBlockers.map((blocker) => (
                  <li key={blocker.code}>{blocker.message}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="text-muted-foreground text-xs">Variantes activas</p>
              <p>
                {activeVariants.length} de {product.variants.length}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Stock total</p>
              <p>{totalStock} unidades</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Imágenes</p>
              <p>{product.images.length}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Información general</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-muted-foreground text-xs">Precio</p>
            <p>
              {product.defaultPriceAmount !== null
                ? minorUnitsToDisplay(product.defaultPriceAmount)
                : "Sin definir"}
            </p>
          </div>
          {canViewCost && (
            <div>
              <p className="text-muted-foreground text-xs">Costo de referencia</p>
              <p>
                {product.referenceCostAmount !== null
                  ? minorUnitsToDisplay(product.referenceCostAmount)
                  : "Sin definir"}
              </p>
            </div>
          )}
          <div>
            <p className="text-muted-foreground text-xs">Marca</p>
            <p>{product.brand?.name ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Slug</p>
            <p className="font-mono text-xs">{product.slug}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Imágenes</CardTitle>
        </CardHeader>
        <CardContent>
          {canManageImages ? (
            <ProductImagesManager
              productId={product.id}
              images={product.images.map((image) => ({
                id: image.id,
                url: getProductImagePublicUrl(image),
                altText: image.altText,
                isPrimary: image.isPrimary,
              }))}
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              No tenés permiso para gestionar imágenes.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Variantes</CardTitle>
        </CardHeader>
        <CardContent>
          <VariantManager
            productId={product.id}
            hasSizeGroup={product.sizeGroupId !== null}
            sizeOptions={sizeOptions.map((s) => ({ id: s.id, label: s.label }))}
            colors={colors.map((c) => ({ id: c.id, displayName: c.displayName }))}
            existingVariants={product.variants.map((v) => ({
              id: v.id,
              sku: v.sku,
              isActive: v.isActive,
              sizeName: v.sizeOption?.label ?? null,
              colorName: v.color?.displayName ?? null,
            }))}
            canManage={canEdit}
          />
        </CardContent>
      </Card>
    </div>
  );
}
