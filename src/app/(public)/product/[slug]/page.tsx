import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProductImage } from "@/components/catalog/product-image";
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

  const primaryImage = product.images.find((image) => image.isPrimary) ?? product.images[0];
  const secondaryImages = product.images.filter((image) => image !== primaryImage);

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-2">
      <div>
        <div className="bg-muted relative aspect-square overflow-hidden rounded-xl">
          <ProductImage
            src={primaryImage?.url ?? null}
            alt={primaryImage?.altText ?? product.name}
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
            priority
          />
        </div>
        {secondaryImages.length > 0 && (
          <div className="mt-4 grid grid-cols-4 gap-2">
            {secondaryImages.map((image) => (
              <div
                key={image.url}
                className="bg-muted relative aspect-square overflow-hidden rounded-lg"
              >
                <ProductImage
                  src={image.url}
                  alt={image.altText ?? product.name}
                  sizes="120px"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-6">
        <div>
          {(product.brandName ?? product.categoryName) && (
            <p className="text-muted-foreground text-sm">
              {[product.brandName, product.categoryName].filter(Boolean).join(" · ")}
            </p>
          )}
          <h1 className="font-heading text-3xl font-semibold">{product.name}</h1>
          {product.shortDescription && (
            <p className="text-muted-foreground mt-2">{product.shortDescription}</p>
          )}
        </div>

        <ProductVariantSelector productId={product.id} variants={product.variants} />

        {product.description && (
          <p className="text-muted-foreground text-sm text-pretty">{product.description}</p>
        )}
      </div>
    </div>
  );
}
