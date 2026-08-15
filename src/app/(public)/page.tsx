import { BenefitsStrip } from "@/components/home/benefits-strip";
import { CategoryTiles } from "@/components/home/category-tiles";
import { FeaturedProducts } from "@/components/home/featured-products";
import { Hero } from "@/components/home/hero";

export default function HomePage() {
  return (
    <div className="flex flex-col">
      <Hero />
      <CategoryTiles />
      <FeaturedProducts />
      <BenefitsStrip />
    </div>
  );
}
