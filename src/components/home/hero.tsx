import { ArrowRight, Sparkles } from "lucide-react";
import Link from "next/link";

import { ProductImage } from "@/components/catalog/product-image";
import { listPublicProducts } from "@/modules/products/public-queries";

export async function Hero() {
  const products = await listPublicProducts({ take: 3, sort: "newest" });
  const [heroProduct, secondaryProduct, tertiaryProduct] = products;

  return (
    <section className="relative overflow-hidden border-b border-[#eee2da] bg-[#fffaf6]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-32 top-12 size-[30rem] rounded-full bg-[#f6d8d3]/45 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-16 size-[28rem] rounded-full bg-[#d8f1f2]/55 blur-3xl"
      />

      <div className="relative mx-auto grid min-h-[650px] max-w-[1380px] items-center gap-12 px-5 py-14 sm:px-8 sm:py-18 lg:grid-cols-[0.9fr_1.1fr] lg:px-10 lg:py-20 xl:gap-20">
        <div className="relative z-10 max-w-xl">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#ead7ce] bg-white/70 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#92746a] backdrop-blur-sm">
            <Sparkles className="size-3.5 text-[#d98791]" aria-hidden="true" />
            Nueva colección
          </div>

          <h1 className="font-heading max-w-[620px] text-[clamp(3rem,6vw,5.7rem)] leading-[0.95] font-medium tracking-[-0.045em] text-[#2f2926]">
            Estilo que
            <span className="block italic text-[#159aa0]">habla de vos.</span>
          </h1>

          <p className="mt-7 max-w-lg text-base leading-7 text-[#716661] sm:text-lg sm:leading-8">
            Prendas pensadas para acompañarte todos los días, con diseño, comodidad y personalidad.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/catalog?sort=newest"
              className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#169aa0] px-6 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(22,154,160,0.18)] transition hover:-translate-y-0.5 hover:bg-[#11868b]"
            >
              Ver novedades
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>

            <Link
              href="/catalog"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#d9c0b3] bg-white/65 px-6 text-sm font-medium text-[#574b46] transition hover:-translate-y-0.5 hover:bg-white"
            >
              Explorar colección
            </Link>
          </div>

          <div className="mt-11 flex items-center gap-6 border-t border-[#e8d9d1] pt-6 text-xs uppercase tracking-[0.15em] text-[#8d817b]">
            <span>Moda femenina</span>
            <span className="size-1 rounded-full bg-[#dfa09c]" aria-hidden="true" />
            <span>CHAIOBOUTIQUE</span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[690px] pb-10 sm:pb-14 lg:pb-8">
          <div className="absolute -left-5 top-14 hidden h-[76%] w-[56%] rotate-[-5deg] rounded-[2.5rem] border border-[#ebdcd4] bg-[#f8e7e1] sm:block" aria-hidden="true" />
          <div className="absolute -right-4 top-5 hidden h-[72%] w-[50%] rotate-[5deg] rounded-[2.5rem] border border-[#dcebed] bg-[#e7f4f4] sm:block" aria-hidden="true" />

          <div className="relative ml-auto aspect-[4/5] w-[88%] overflow-hidden rounded-[2rem] border border-white/80 bg-[#f3ebe5] shadow-[0_30px_80px_rgba(94,73,60,0.14)] sm:w-[76%] sm:rounded-[2.5rem]">
            {heroProduct ? (
              <Link href={`/product/${heroProduct.slug}`} className="group absolute inset-0 block">
                <ProductImage
                  src={heroProduct.primaryImageUrl}
                  alt={heroProduct.name}
                  sizes="(min-width: 1280px) 40vw, (min-width: 1024px) 46vw, 85vw"
                  className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.035]"
                  priority
                />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 via-black/8 to-transparent px-6 pb-6 pt-24 text-white sm:px-8 sm:pb-8">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/80">Lo nuevo</p>
                  <p className="mt-1 font-heading text-xl sm:text-2xl">{heroProduct.name}</p>
                </div>
              </Link>
            ) : (
              <div className="absolute inset-0 bg-gradient-to-br from-[#f7dfd9] via-[#fff8f3] to-[#dceff0]">
                <div className="absolute left-[18%] top-[18%] size-32 rounded-full bg-[#f2b8b4]/35 blur-2xl" />
                <div className="absolute bottom-[14%] right-[15%] size-40 rounded-full bg-[#8ed6da]/30 blur-3xl" />
              </div>
            )}
          </div>

          {secondaryProduct && (
            <Link
              href={`/product/${secondaryProduct.slug}`}
              className="group absolute bottom-0 left-0 hidden aspect-[3/4] w-[31%] overflow-hidden rounded-[1.5rem] border-[6px] border-[#fffaf6] bg-[#f2e8e2] shadow-[0_18px_45px_rgba(77,60,50,0.16)] sm:block"
              aria-label={`Ver ${secondaryProduct.name}`}
            >
              <ProductImage
                src={secondaryProduct.primaryImageUrl}
                alt={secondaryProduct.name}
                sizes="220px"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
            </Link>
          )}

          {tertiaryProduct && (
            <Link
              href={`/product/${tertiaryProduct.slug}`}
              className="group absolute -right-1 bottom-12 hidden aspect-square w-[22%] overflow-hidden rounded-full border-[6px] border-[#fffaf6] bg-[#e6f2f2] shadow-[0_16px_35px_rgba(77,60,50,0.12)] xl:block"
              aria-label={`Ver ${tertiaryProduct.name}`}
            >
              <ProductImage
                src={tertiaryProduct.primaryImageUrl}
                alt={tertiaryProduct.name}
                sizes="160px"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
              />
            </Link>
          )}

          <div className="absolute -right-1 top-10 rounded-2xl border border-white/80 bg-white/80 px-4 py-3 shadow-[0_12px_35px_rgba(88,67,56,0.08)] backdrop-blur-md sm:right-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#9a7b70]">Elegí tu estilo</p>
            <p className="mt-1 font-heading text-sm text-[#3b322e]">Sentí tu esencia</p>
          </div>
        </div>
      </div>
    </section>
  );
}
