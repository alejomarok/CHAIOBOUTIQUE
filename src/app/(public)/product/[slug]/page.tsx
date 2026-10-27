import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, Truck } from "lucide-react";

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
    <div className="mx-auto max-w-[1440px] px-6 py-8 sm:px-10 sm:py-10 lg:px-16">
      <Link
        href="/catalog"
        className="editorial-link text-muted-foreground mb-8 inline-flex min-h-11 items-center gap-3 text-sm"
      >
        <ArrowLeft className="size-4" aria-hidden="true" /> Volver a la colección
      </Link>
      <div className="grid items-start gap-10 md:grid-cols-2 md:gap-14 lg:gap-20">
        <ProductGallery images={product.images} productName={product.name} />

        <div className="flex flex-col gap-7 md:sticky md:top-44 md:py-4">
          <div className="flex flex-col gap-2">
            {(product.brandName ?? product.categoryName) && (
              <p className="text-muted-foreground text-sm">
                {[product.brandName, product.categoryName].filter(Boolean).join(" · ")}
              </p>
            )}
            <h1 className="font-heading text-4xl leading-tight font-normal tracking-[-0.035em] text-balance lg:text-5xl">
              {product.name}
            </h1>
            {product.shortDescription && (
              <p className="text-muted-foreground text-pretty">{product.shortDescription}</p>
            )}
          </div>

          <ProductVariantSelector productId={product.id} variants={product.variants} />

          {product.description && (
            <>
              <details className="bg-muted px-5 py-4" open>
                <summary className="cursor-pointer text-sm font-medium">Sobre esta prenda</summary>
                <p className="text-muted-foreground mt-4 text-base leading-7 whitespace-pre-line">
                  {product.description}
                </p>
              </details>
            </>
          )}
          <div className="text-primary grid gap-4 bg-[#e9ece5] p-5 text-sm">
            <p className="flex items-center gap-3">
              <Truck className="size-4 shrink-0" aria-hidden="true" /> Coordinamos el envío de tu
              pedido.
            </p>
            <p className="flex items-center gap-3">
              <ShieldCheck className="size-4 shrink-0" aria-hidden="true" /> Pago seguro con Mercado
              Pago.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
