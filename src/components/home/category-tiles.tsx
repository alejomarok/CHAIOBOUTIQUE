import Link from "next/link";

import { listCategories } from "@/modules/categories/service";

const MAX_TILES = 5;

// Rotating, restrained tints — one accent per tile, never mixed on the same
// tile, so the section reads as "boutique with a few colorful notes," not
// a rainbow. Purely decorative (no category images exist yet).
const TILE_ACCENTS = [
  "from-accent-cyan/20",
  "from-accent-pink/20",
  "from-accent-yellow/25",
  "from-accent-lime/20",
  "from-accent-orange/20",
];

export async function CategoryTiles() {
  const categories = await listCategories();
  const tiles = categories
    .filter((category) => category.parentId === null && category.isActive && category._count.products > 0)
    .slice(0, MAX_TILES);

  // A "discover by category" section only earns its place once there's
  // real, browsable variety — otherwise it's skipped rather than padded
  // with empty or invented destinations.
  if (tiles.length < 2) return null;

  return (
    <section className="mx-auto max-w-7xl px-4 pt-10 pb-16 sm:px-6 sm:pt-14 sm:pb-20 lg:px-8">
      <div className="mb-8 flex flex-col gap-2">
        <h2 className="font-heading text-2xl font-semibold sm:text-3xl">Explorá por categoría</h2>
        <p className="text-muted-foreground text-sm sm:text-base">
          Encontrá justo lo que estás buscando.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-5">
        {tiles.map((category, index) => (
          <Link
            key={category.id}
            href={`/catalog?category=${category.id}`}
            className={`group ring-border/60 relative flex aspect-[4/5] flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br ${TILE_ACCENTS[index % TILE_ACCENTS.length]} to-background ring-1 transition-transform duration-300 ease-out hover:-translate-y-1`}
          >
            <div className="from-foreground/55 absolute inset-0 bg-gradient-to-t via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-10" />
            <div className="relative flex flex-col gap-0.5 p-4">
              <span className="font-heading text-lg font-semibold sm:text-xl">{category.name}</span>
              <span className="text-muted-foreground text-xs">
                {category._count.products} {category._count.products === 1 ? "producto" : "productos"}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
