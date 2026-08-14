import Link from "next/link";
import { notFound } from "next/navigation";

import { minorUnitsToDisplay } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requirePermission } from "@/modules/auth";
import { listSizeOptions, listColors } from "@/modules/attributes/service";
import {
  getTotalStockForVariants,
  listInventoryBalances,
} from "@/modules/inventory/service";
import {
  computeProductCompletionSteps,
  type ProductCompletionStepKey,
  type ProductCompletionStepStatus,
} from "@/modules/products/completion-checklist";
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

// Each guided step's action button — plain-Spanish label + where it goes.
// "#variantes"/"#stock"/"#imagenes" jump to that section further down this
// same single page (see the sprint's decision: guided sections, not a
// multi-screen wizard). "publication" has no link of its own: the actual
// Publicar/Despublicar action already lives in the page header
// (ProductStatusActions) — duplicating that server call here would mean two
// places that can trigger it, so this step just points the admin back up.
const STEP_ACTIONS: Record<
  ProductCompletionStepKey,
  { label: string; href?: string } | null
> = {
  basicInfo: { label: "Editar información" },
  categoryAndSize: { label: "Asignar categoría" },
  variants: { label: "Crear variantes", href: "#variantes" },
  stock: { label: "Cargar stock", href: "#stock" },
  images: { label: "Subir imágenes", href: "#imagenes" },
  publication: null,
};

const STEP_STATUS_BADGE: Record<
  ProductCompletionStepStatus,
  { label: string; variant: "default" | "outline" | "secondary" | "destructive" }
> = {
  complete: { label: "Completo", variant: "default" },
  pending: { label: "Pendiente", variant: "secondary" },
  attention: { label: "Requiere atención", variant: "destructive" },
};

export const metadata = { title: "Detalle de producto" };

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("products.view");
  const { id } = await params;

  const [product, colors] = await Promise.all([getProductById(id), listColors()]);
  if (!product) notFound();

  const activeVariants = product.variants.filter((v) => v.isActive);
  const variantIds = product.variants.map((v) => v.id);

  // Required behavior #3: the variant matrix only ever offers options from
  // the product's own SizeGroup, never the full catalog — a size-less
  // product (no sizeGroupId) gets an empty list, not every size that
  // exists anywhere. None of these three depend on each other — only on
  // `product`, already resolved above — so they run as one round trip each,
  // concurrently, instead of three sequential ones (previously
  // listSizeOptions was awaited on its own before the stock Promise.all
  // even though nothing in that Promise.all needs sizeOptions).
  const [sizeOptions, totalStock, balances] = await Promise.all([
    product.sizeGroupId ? listSizeOptions(product.sizeGroupId) : Promise.resolve([]),
    getTotalStockForVariants(activeVariants.map((v) => v.id)),
    listInventoryBalances({ variantIds }),
  ]);

  // See modules/products/visibility.ts — this is the exact, single rule
  // both /catalog and /product/[slug] use, surfaced here so an admin never
  // has to guess why a product isn't showing up publicly.
  const visibilityBlockers = getVisibilityBlockers(product, product.variants);
  const isPubliclyVisible = visibilityBlockers.length === 0;

  const completionSteps = computeProductCompletionSteps({
    hasPrice: product.defaultPriceAmount !== null,
    hasCategory: product.categoryId !== null,
    hasSizeGroup: product.sizeGroupId !== null,
    hasVariants: activeVariants.length > 0,
    hasStock: totalStock > 0,
    hasImages: product.images.length > 0,
    isPublished: product.status === "ACTIVE",
  });

  const canViewCost = user.permissions.has("products.view_cost");
  const canEdit = user.permissions.has("products.edit");
  const canManageImages = user.permissions.has("product_images.manage");
  const canAdjustStock = user.permissions.has("stock.adjust");

  const overallStatusLabel =
    product.status === "ACTIVE"
      ? "Publicado"
      : completionSteps.some((s) => s.status === "attention")
        ? "Incompleto"
        : "Borrador";

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
          {isPubliclyVisible && (
            <Button asChild variant="ghost">
              <Link href={`/product/${product.slug}`} target="_blank">
                Ver en la tienda ↗
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Summary card — the answer to "what state is this product in" at a
          glance, in plain Spanish, no internal terminology. */}
      <Card>
        <CardHeader>
          <CardTitle>Resumen</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-muted-foreground text-xs">Estado</p>
            <p className="font-medium">{overallStatusLabel}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Visible en el catálogo</p>
            <p className="font-medium">{isPubliclyVisible ? "Sí" : "No"}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Precio</p>
            <p className="font-medium">
              {product.defaultPriceAmount !== null
                ? minorUnitsToDisplay(product.defaultPriceAmount)
                : "Sin definir"}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Variantes activas</p>
            <p className="font-medium">
              {activeVariants.length} de {product.variants.length}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Stock total</p>
            <p className="font-medium">{totalStock} unidades</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Imágenes</p>
            <p className="font-medium">{product.images.length}</p>
          </div>
        </CardContent>
      </Card>

      {/* Prominent "why isn't this public" panel — only shown when it
          actually isn't, per required behavior #7. */}
      {!isPubliclyVisible && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle>Este producto todavía no aparece en la tienda</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {visibilityBlockers.map((blocker) => {
                const step = completionSteps.find(
                  (s) =>
                    (blocker.code === "NOT_ACTIVE_STATUS" && s.key === "publication") ||
                    (blocker.code === "NO_CATEGORY" && s.key === "categoryAndSize") ||
                    (blocker.code === "NO_ACTIVE_VARIANTS" && s.key === "variants") ||
                    (blocker.code === "VARIANT_MISSING_PRICE" && s.key === "basicInfo"),
                );
                const action = step ? STEP_ACTIONS[step.key] : null;
                return (
                  <li key={blocker.code} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{blocker.message}</span>
                    {action &&
                      (action.href ? (
                        <Button asChild size="sm" variant="outline">
                          <Link href={action.href}>{action.label}</Link>
                        </Button>
                      ) : (
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/admin/products/${product.id}/edit`}>{action.label}</Link>
                        </Button>
                      ))}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Guided steps — the 6-step checklist, each with its own status and
          direct action. */}
      <Card>
        <CardHeader>
          <CardTitle>Pasos para completar el producto</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {completionSteps.map((step) => {
            const badge = STEP_STATUS_BADGE[step.status];
            const action = STEP_ACTIONS[step.key];
            const actionHref = action?.href ?? `/admin/products/${product.id}/edit`;
            return (
              <div
                key={step.key}
                className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{step.label}</span>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  {step.detail && (
                    <p className="text-muted-foreground mt-0.5 text-sm">{step.detail}</p>
                  )}
                </div>
                {action && step.status !== "complete" && (
                  <Button asChild size="sm" variant="outline">
                    <Link href={actionHref}>{action.label}</Link>
                  </Button>
                )}
              </div>
            );
          })}
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

      {/* Stock — every warehouse's balance for every variant, never a
          browser-side sum: totalStock above and each row's quantity both
          come straight from modules/inventory/service.ts's server-side
          aggregation (getTotalStockForVariants / listInventoryBalances). */}
      <Card id="stock">
        <CardHeader>
          <CardTitle>Stock</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {activeVariants.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Este producto todavía no tiene variantes activas — creá una variante para poder
              cargar stock.
            </p>
          ) : balances.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Las variantes de este producto todavía no tienen stock cargado.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    <th className="pb-2 pr-3 font-medium">Talle</th>
                    <th className="pb-2 pr-3 font-medium">Color</th>
                    <th className="pb-2 pr-3 font-medium">SKU</th>
                    <th className="pb-2 pr-3 font-medium">Depósito</th>
                    <th className="pb-2 font-medium">Disponible</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.map((balance) => (
                    <tr key={balance.id} className="border-border border-t">
                      <td className="py-1.5 pr-3">{balance.variant.sizeOption?.label ?? "—"}</td>
                      <td className="py-1.5 pr-3">{balance.variant.color?.displayName ?? "—"}</td>
                      <td className="py-1.5 pr-3 font-mono text-xs">{balance.variant.sku}</td>
                      <td className="py-1.5 pr-3">{balance.warehouse.name}</td>
                      <td className="py-1.5">{balance.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-sm font-medium">Stock total del producto: {totalStock} unidades</p>
          {canAdjustStock && (
            <div className="flex flex-wrap gap-2">
              <Button asChild size="sm" variant="outline">
                <Link
                  href={
                    activeVariants[0]
                      ? `/admin/inventory/adjustments?variantId=${activeVariants[0].id}`
                      : "/admin/inventory/adjustments"
                  }
                >
                  Cargar stock inicial
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href="/admin/inventory/movements">Ver movimientos</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card id="imagenes">
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

      <Card id="variantes">
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
