import { ArrowRight, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-[#eee1da] bg-[#fffaf6]">
      {/* Desktop / tablet campaign image */}
      <div className="absolute inset-0 hidden md:block">
        <Image
          src="/images/home/hero-chaio-desktop.webp"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />

        {/* The generated artwork intentionally leaves negative space on the
            left. This overlay strengthens contrast without hiding the image. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-[#fffaf6] via-[#fffaf6]/88 to-[#fffaf6]/5"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-[#fffaf6]/25 via-transparent to-white/10"
        />
      </div>

      {/* Desktop content */}
      <div className="relative mx-auto hidden min-h-[650px] max-w-[1380px] items-center px-8 lg:px-10 md:flex">
        <div className="relative z-10 max-w-[610px] py-20">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#e9d6cc] bg-white/75 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#917369] shadow-sm backdrop-blur-md">
            <Sparkles className="size-3.5 text-[#db8791]" aria-hidden="true" />
            Nueva colección
          </div>

          <h1 className="font-heading text-[clamp(3.7rem,6vw,6.2rem)] leading-[0.92] font-medium tracking-[-0.05em] text-[#302926]">
            Estilo que
            <span className="block italic text-[#159aa0]">habla de vos.</span>
          </h1>

          <p className="mt-7 max-w-[520px] text-base leading-7 text-[#6f625d] lg:text-lg lg:leading-8">
            Prendas pensadas para acompañarte todos los días, con diseño,
            comodidad y personalidad.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/catalog?sort=newest"
              className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#159aa0] px-6 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(21,154,160,0.20)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#11868b]"
            >
              Ver novedades
              <ArrowRight
                className="size-4 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>

            <Link
              href="/catalog"
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#d8beb0] bg-white/72 px-6 text-sm font-medium text-[#564943] shadow-sm backdrop-blur-sm transition duration-200 hover:-translate-y-0.5 hover:bg-white"
            >
              Explorar colección
            </Link>
          </div>

          <div className="mt-11 flex items-center gap-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#8f817a]">
            <span>Diseño</span>
            <span className="size-1 rounded-full bg-[#e1a29d]" aria-hidden="true" />
            <span>Comodidad</span>
            <span className="size-1 rounded-full bg-[#9ed6d7]" aria-hidden="true" />
            <span>Personalidad</span>
          </div>
        </div>

        {/* Small editorial label over the photographic side */}
        <div className="absolute bottom-9 right-10 hidden rounded-2xl border border-white/80 bg-white/68 px-4 py-3 shadow-[0_14px_40px_rgba(84,62,51,0.09)] backdrop-blur-md lg:block">
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[#9a7b70]">
            CHAIOBOUTIQUE
          </p>
          <p className="mt-1 font-heading text-sm italic text-[#443833]">
            Elegí tu estilo. Sentí tu esencia.
          </p>
        </div>
      </div>

      {/* Mobile: copy first, then a dedicated crop of the exact same campaign */}
      <div className="md:hidden">
        <div className="relative z-10 px-5 pb-9 pt-10 sm:px-7">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#ead8ce] bg-white/80 px-3.5 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#917369]">
            <Sparkles className="size-3.5 text-[#db8791]" aria-hidden="true" />
            Nueva colección
          </div>

          <h1 className="font-heading text-[clamp(3rem,14vw,4.7rem)] leading-[0.94] font-medium tracking-[-0.045em] text-[#302926]">
            Estilo que
            <span className="block italic text-[#159aa0]">habla de vos.</span>
          </h1>

          <p className="mt-5 max-w-md text-[15px] leading-6 text-[#71645e]">
            Prendas pensadas para acompañarte todos los días, con diseño,
            comodidad y personalidad.
          </p>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Link
              href="/catalog?sort=newest"
              className="group inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#159aa0] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(21,154,160,0.18)]"
            >
              Ver novedades
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>

            <Link
              href="/catalog"
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-[#dbc4b8] bg-white px-5 text-sm font-medium text-[#564943]"
            >
              Ver colección
            </Link>
          </div>
        </div>

        <div className="relative mx-3 mb-4 aspect-[4/5] overflow-hidden rounded-[1.75rem] border border-white bg-[#f4e8e1] shadow-[0_20px_55px_rgba(92,69,56,0.12)] sm:mx-5">
          <Image
            src="/images/home/hero-chaio-mobile.webp"
            alt="Modelo luciendo una propuesta femenina en tonos pastel de CHAIOBOUTIQUE"
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />

          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/18 to-transparent"
          />

          <div className="absolute bottom-4 left-4 rounded-full border border-white/80 bg-white/75 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.17em] text-[#705e56] backdrop-blur-md">
            Moda para sentirte vos
          </div>
        </div>
      </div>
    </section>
  );
}
