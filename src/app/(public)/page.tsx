import { BenefitsStrip } from "@/components/home/benefits-strip";
import { CategoryTiles } from "@/components/home/category-tiles";
import { FeaturedProducts } from "@/components/home/featured-products";
import { Hero } from "@/components/home/hero";
import { CampaignStory } from "@/components/home/campaign-story";
import { StorefrontMotion } from "@/components/home/storefront-motion";

export default function HomePage() {
  return (
    <div className="bg-background flex flex-col overflow-hidden">
      <Hero />
      <FeaturedProducts />
      <CategoryTiles />
      <CampaignStory />
      <BenefitsStrip />
      <StorefrontMotion />
    </div>
  );
}
