import { ArrowDown, ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function Hero() {
  return (
    <section className="campaign-hero relative isolate min-h-[600px] overflow-hidden bg-[#c7b9a5] text-white md:min-h-[690px]">
      <Image
        src="/images/campaign/chaio-campaign-hero.webp"
        alt="Campaña de moda femenina: una modelo en un patio de piedra"
        fill
        preload
        sizes="100vw"
        className="campaign-hero-image object-cover object-[62%_center] md:object-[center_18%]"
      />
      <div aria-hidden="true" className="absolute inset-0 bg-black/25" />
      <div className="relative mx-auto flex min-h-[600px] max-w-[1440px] flex-col justify-end px-6 pt-28 pb-12 sm:px-10 md:min-h-[690px] md:justify-center md:py-24 lg:px-16">
        <div className="max-w-[620px]">
          <h1 className="hero-enter font-heading text-[clamp(3.25rem,6.7vw,6.6rem)] leading-[1.03] font-normal tracking-[-0.045em]">
            Tu esencia,
            <br />a tu manera.
          </h1>
          <p className="hero-enter mt-7 max-w-[330px] text-base leading-relaxed text-white/95 [animation-delay:100ms] md:max-w-[370px] md:text-lg">
            Moda femenina para moverte con libertad. Prendas que se sienten como vos.
          </p>
          <Link
            href="/catalog?sort=newest"
            className="campaign-button hero-enter mt-8 inline-flex min-h-13 items-center gap-7 bg-white px-6 text-sm font-medium text-[#242b28] [animation-delay:180ms] hover:bg-[#eceee8]"
          >
            Descubrí la colección <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
        <a
          href="#novedades"
          aria-label="Explorar las novedades"
          className="absolute right-6 bottom-7 hidden size-11 items-center justify-center rounded-full bg-white/15 transition-colors hover:bg-white/30 sm:right-10 sm:flex lg:right-16"
        >
          <ArrowDown className="size-4" aria-hidden="true" />
        </a>
      </div>
    </section>
  );
}
