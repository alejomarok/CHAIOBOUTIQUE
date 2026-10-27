import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

import { ProductImage } from "@/components/catalog/product-image";
import { getCategoryImagePublicUrl } from "@/modules/categories/category-images";
import { listStorefrontNavCategories } from "@/modules/categories/service";
import { listPublicProducts } from "@/modules/products/public-queries";

const MAX_TILES = 4;

const TILE_BACKGROUNDS = ["bg-[#eeede7]", "bg-[#e9ece5]", "bg-[#eeede7]", "bg-[#e9ece5]"];

// Image priority (Phase — Admin-Controlled Category Images):
//   1. The category's own admin-controlled storefront image
//      (Category.imageBucket/imagePath — see /admin/categories/[id]).
//   2. Falls back to the existing "newest product's primary image" lookup,
//      for backward compatibility with a category nobody has curated an
//      image for yet — never a broken tile just because migration added
//      these columns as null on every pre-existing category.
//   3. An editorial campaign image when neither exists. Product detail
//      images remain the merchant's own photos; campaign art is not a SKU.
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
          imageUrl: getCategoryImagePublicUrl({
            imageBucket: category.imageBucket,
            imagePath: category.imagePath,
          }),
          campaign: false,
        };
      }

      const [product] = await listPublicProducts({
        categoryId: category.id,
        take: 1,
        sort: "newest",
      });

      const name = category.name.toLocaleLowerCase("es-AR");
      const campaignFile = /vestid|falda/.test(name)
        ? "movement"
        : /pantal|conjunto|sastr/.test(name)
          ? "linen"
          : /remera|camisa|top/.test(name)
            ? "hero"
            : "detail";
      return {
        category,
        imageUrl:
          product?.primaryImageUrl ?? `/images/campaign/chaio-campaign-${campaignFile}.webp`,
        campaign: !product?.primaryImageUrl,
      };
    }),
  );

  return (
    <section className="bg-[#f0f0e9] py-16 sm:py-20" aria-labelledby="categories-title">
      <div className="mx-auto max-w-[1440px] px-6 sm:px-10 lg:px-16">
        <div className="mb-9 flex flex-col gap-4 sm:mb-12">
          <h2
            id="categories-title"
            data-reveal
            className="font-heading text-4xl font-normal tracking-[-0.035em] sm:text-5xl"
          >
            Cada día, un estilo.
          </h2>
          <p data-reveal className="text-muted-foreground max-w-xl text-base leading-6">
            Explorá la colección y hacela tuya.
          </p>
        </div>

        <div
          className={`grid grid-cols-2 gap-4 sm:gap-6 ${tiles.length === 3 ? "lg:grid-cols-3" : tiles.length === 4 ? "lg:grid-cols-4" : ""}`}
        >
          {tiles.map(({ category, imageUrl, campaign }, index) => (
            <Link
              key={category.id}
              data-reveal
              href={`/catalog?category=${category.id}`}
              className={`group relative aspect-[3/4] overflow-hidden ${TILE_BACKGROUNDS[index % TILE_BACKGROUNDS.length]}`}
            >
              <ProductImage
                src={imageUrl}
                alt={
                  campaign
                    ? `Inspiración de estilo para ${category.name}`
                    : category.imageAltText || category.name
                }
                sizes="(min-width: 1024px) 25vw, 50vw"
                className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]"
              />

              <div aria-hidden="true" className="absolute inset-0 bg-black/40" />

              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 text-white sm:p-5">
                <div>
                  <p className="font-heading text-xl font-normal sm:text-3xl">{category.name}</p>
                </div>

                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/90 text-[#3d3430] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
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
