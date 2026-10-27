import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";

import { CatalogFilters } from "@/components/catalog/catalog-filters";
import { CatalogFiltersSheet } from "@/components/catalog/catalog-filters-sheet";
import { ProductCard } from "@/components/catalog/product-card";
import { Button } from "@/components/ui/button";
import { listCategories } from "@/modules/categories/service";
import { listPublicProducts } from "@/modules/products/public-queries";

export const metadata = { title: "Catálogo" };

const PAGE_SIZE = 24;
const MAX_PAGE = Math.floor(2_147_483_647 / PAGE_SIZE) + 1;

interface CatalogPageProps {
  searchParams: Promise<{ q?: string; category?: string; sort?: string; page?: string }>;
}

function isValidSort(value: string | undefined): value is "newest" | "price_asc" | "price_desc" {
  return value === "newest" || value === "price_asc" || value === "price_desc";
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const params = await searchParams;
  const requestedPage = Number(params.page);
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= MAX_PAGE
      ? requestedPage
      : 1;
  const sort = isValidSort(params.sort) ? params.sort : "newest";
  const defaultValues = { q: params.q, category: params.category, sort };

  const [productResults, categories] = await Promise.all([
    listPublicProducts({
      search: params.q || undefined,
      categoryId: params.category || undefined,
      sort,
      take: PAGE_SIZE + 1,
      skip: (page - 1) * PAGE_SIZE,
    }),
    listCategories(),
  ]);

  const hasNextPage = productResults.length > PAGE_SIZE;
  const products = productResults.slice(0, PAGE_SIZE);

  function pageHref(targetPage: number) {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    if (params.category) query.set("category", params.category);
    query.set("sort", sort);
    if (targetPage > 1) query.set("page", String(targetPage));
    return `/catalog?${query.toString()}`;
  }

  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));
  const activeCategoryName = categories.find((c) => c.id === params.category)?.name;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <div className="border-border mb-10 flex flex-col gap-3 border-b pb-8">
        <p className="text-muted-foreground text-[10px] font-medium tracking-[0.22em] uppercase">
          CHAIOBOUTIQUE · Moda femenina
        </p>
        <h1 className="font-heading text-4xl font-normal tracking-tight sm:text-5xl">
          {activeCategoryName ?? "La colección"}
        </h1>
        <p className="text-muted-foreground max-w-lg text-sm leading-relaxed">
          Encontrá esas prendas que se sienten tan bien como se ven.
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-muted-foreground text-sm">
            {products.length === 0
              ? "Sin resultados"
              : `${products.length} ${products.length === 1 ? "producto" : "productos"}`}
          </p>
          <CatalogFiltersSheet categories={categoryOptions} defaultValues={defaultValues} />
        </div>
      </div>

      <div className="grid gap-10 md:grid-cols-[220px_1fr] lg:gap-12">
        <aside className="hidden md:block">
          <div className="sticky top-44">
            <CatalogFilters categories={categoryOptions} defaultValues={defaultValues} />
          </div>
        </aside>
        <div>
          {products.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-24 text-center">
              <p className="text-muted-foreground text-lg">
                No encontramos productos con esos filtros.
              </p>
              <Button asChild variant="outline">
                <Link href={page > 1 ? pageHref(page - 1) : "/catalog"}>
                  {page > 1 ? "Volver a la página anterior" : "Limpiar filtros"}
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
          {(page > 1 || hasNextPage) && (
            <nav
              aria-label="Paginación del catálogo"
              className="border-border mt-12 flex flex-wrap items-center justify-between gap-4 border-t pt-6"
            >
              {page > 1 ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(page - 1)} rel="prev">
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    Anterior
                  </Link>
                </Button>
              ) : (
                <span />
              )}
              <span className="text-muted-foreground text-sm" aria-current="page">
                Página {page}
              </span>
              {hasNextPage ? (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(page + 1)} rel="next">
                    Siguiente
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
