import { CatalogFilters } from "@/components/catalog/catalog-filters";
import { ProductCard } from "@/components/catalog/product-card";
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
      <h1 className="font-heading mb-8 text-3xl font-semibold">Catálogo</h1>
      <div className="grid gap-8 md:grid-cols-[220px_1fr]">
        <aside>
          <CatalogFilters
            categories={categories}
            defaultValues={{ q: params.q, category: params.category, sort }}
          />
        </aside>
        <div>
          {products.length === 0 ? (
            <p className="text-muted-foreground py-16 text-center">
              No encontramos productos con esos filtros.
            </p>
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
