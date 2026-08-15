import Link from "next/link";

import { CatalogFilters } from "@/components/catalog/catalog-filters";
import { CatalogFiltersSheet } from "@/components/catalog/catalog-filters-sheet";
import { ProductCard } from "@/components/catalog/product-card";
import { Button } from "@/components/ui/button";
import { listCategories } from "@/modules/categories/service";
import { listPublicProducts } from "@/modules/products/public-queries";

export const metadata = { title: "Catálogo" };

const PAGE_SIZE = 24;

interface CatalogPageProps {
  searchParams: Promise<{ q?: string; category?: string; sort?: string; page?: string }>;
}

function isValidSort(value: string | undefined): value is "newest" | "price_asc" | "price_desc" {
  return value === "newest" || value === "price_asc" || value === "price_desc";
}

export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const sort = isValidSort(params.sort) ? params.sort : "newest";
  const defaultValues = { q: params.q, category: params.category, sort };

  const [products, categories] = await Promise.all([
    listPublicProducts({
      search: params.q || undefined,
      categoryId: params.category || undefined,
      sort,
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
    }),
    listCategories(),
  ]);

  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));
  const activeCategoryName = categories.find((c) => c.id === params.category)?.name;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8">
      <div className="mb-8 flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold sm:text-4xl">
          {activeCategoryName ?? "Catálogo"}
        </h1>
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
          <div className="sticky top-24">
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
                <Link href="/catalog">Limpiar filtros</Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
