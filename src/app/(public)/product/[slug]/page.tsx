import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProductGallery } from "@/components/catalog/product-gallery";
import { ProductVariantSelector } from "@/components/catalog/product-variant-selector";
import { getPublicProductBySlug } from "@/modules/products/public-queries";

interface ProductPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { slug } = await params;
  const product = await getPublicProductBySlug(slug);
  if (!product) return {};

  return {
    title: product.seoTitle ?? product.name,
    description: product.seoDescription ?? product.shortDescription ?? undefined,
  };
}

export default async function ProductDetailPage({ params }: ProductPageProps) {
  const { slug } = await params;
  const product = await getPublicProductBySlug(slug);
  if (!product) notFound();

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 sm:px-6 sm:py-12 md:grid-cols-2 md:gap-12 lg:px-8">
      <ProductGallery images={product.images} productName={product.name} />

      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          {(product.brandName ?? product.categoryName) && (
            <p className="text-muted-foreground text-xs font-semibold tracking-[0.15em] uppercase">
              {[product.brandName, product.categoryName].filter(Boolean).join(" · ")}
            </p>
          )}
          <h1 className="font-heading text-3xl font-semibold text-balance sm:text-4xl">
            {product.name}
          </h1>
          {product.shortDescription && (
            <p className="text-muted-foreground text-pretty">{product.shortDescription}</p>
          )}
        </div>

        <div className="border-border border-t" />

        <ProductVariantSelector productId={product.id} variants={product.variants} />

        {product.description && (
          <>
            <div className="border-border border-t" />
            <p className="text-muted-foreground text-sm text-pretty">{product.description}</p>
          </>
        )}
      </div>
    </div>
  );
}
