import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { ProductImage } from "@/components/catalog/product-image";
import { getCategoryImagePublicUrl } from "@/modules/categories/category-images";
import { listStorefrontNavCategories } from "@/modules/categories/service";
import { listPublicProducts } from "@/modules/products/public-queries";

const MAX_TILES = 4;

const TILE_BACKGROUNDS = [
  "bg-[#f3dfd7]",
  "bg-[#e7f2f2]",
  "bg-[#eee7de]",
  "bg-[#f2e9dc]",
];

// Image priority (Phase — Admin-Controlled Category Images):
//   1. The category's own admin-controlled storefront image
//      (Category.imageBucket/imagePath — see /admin/categories/[id]).
//   2. Falls back to the existing "newest product's primary image" lookup,
//      for backward compatibility with a category nobody has curated an
//      image for yet — never a broken tile just because migration added
//      these columns as null on every pre-existing category.
//   3. ProductImage's own neutral placeholder when neither exists.
// Never an extra per-category product query once a category HAS its own
// image: the fallback's listPublicProducts call only runs for categories
// that actually need it, so a fully-curated set of tiles costs zero N+1
// product queries.
export async function CategoryTiles() {
  const categories = await listStorefrontNavCategories();
  const visibleCategories = categories
    .filter((category) => category._count.products > 0)
    .slice(0, MAX_TILES);

  if (visibleCategories.length < 2) return null;

  const tiles = await Promise.all(
    visibleCategories.map(async (category) => {
      if (category.imageBucket && category.imagePath) {
        return {
          category,
          imageUrl: getCategoryImagePublicUrl({ imageBucket: category.imageBucket, imagePath: category.imagePath }),
        };
      }

      const [product] = await listPublicProducts({
        categoryId: category.id,
        take: 1,
        sort: "newest",
      });

      return { category, imageUrl: product?.primaryImageUrl ?? null };
    }),
  );

  return (
    <section className="bg-[#fffdfb] py-16 sm:py-20 lg:py-24">
      <div className="mx-auto max-w-[1380px] px-5 sm:px-8 lg:px-10">
        <div className="mb-9 flex flex-col gap-3 text-center sm:mb-12">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#a37c6c]">
            Encontrá tu próximo favorito
          </p>
          <h2 className="font-heading text-3xl font-medium tracking-[-0.025em] text-[#342d29] sm:text-4xl">
            Explorá tu estilo ideal
          </h2>
          <p className="mx-auto max-w-xl text-sm leading-6 text-[#80756f] sm:text-base">
            Descubrí la colección por categorías y encontrá esas prendas que se sienten tan vos.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-4">
          {tiles.map(({ category, imageUrl }, index) => (
            <Link
              key={category.id}
              href={`/catalog?category=${category.id}`}
              className={`group relative aspect-[3/4] overflow-hidden rounded-[1.7rem] ${TILE_BACKGROUNDS[index % TILE_BACKGROUNDS.length]} shadow-[0_12px_32px_rgba(80,58,45,0.06)]`}
            >
              <ProductImage
                src={imageUrl}
                alt={category.imageAltText || category.name}
                sizes="(min-width: 1024px) 25vw, 50vw"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
              />

              <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />

              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 text-white sm:p-5">
                <div>
                  <p className="font-heading text-lg font-medium sm:text-2xl">{category.name}</p>
                  <p className="mt-1 text-[11px] text-white/80">
                    {category._count.products} {category._count.products === 1 ? "producto" : "productos"}
                  </p>
                </div>

                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/90 text-[#3d3430] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5">
                  <ArrowUpRight className="size-4" aria-hidden="true" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
