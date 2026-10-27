import { ArrowUpRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

export function CampaignStory() {
  return (
    <section
      id="esencia"
      className="scroll-mt-44 bg-[#e9ece5] py-16 sm:py-24"
      aria-labelledby="story-title"
    >
      <div className="mx-auto grid max-w-[1440px] items-center gap-10 px-6 sm:px-10 md:grid-cols-2 md:gap-16 lg:px-16">
        <div className="relative grid grid-cols-[1fr_0.63fr] items-end gap-4 sm:gap-6">
          <div data-reveal className="relative aspect-[3/4] overflow-hidden bg-[#c9c6bc]">
            <Image
              src="/images/campaign/chaio-campaign-linen.webp"
              alt="Modelo con conjunto de lino arena, una inspiración para vestir todos los días"
              fill
              sizes="(min-width: 768px) 30vw, 58vw"
              className="object-cover"
            />
          </div>
          <div className="flex flex-col gap-4 sm:gap-6">
            <div
              data-reveal
              className="relative aspect-[4/3] overflow-hidden bg-[#d2caba] [--reveal-delay:80ms]"
            >
              <Image
                src="/images/campaign/chaio-campaign-detail.webp"
                alt="Detalle de lino marfil con pliegues naturales y luz de ventana"
                fill
                sizes="(min-width: 768px) 19vw, 36vw"
                className="object-cover"
              />
            </div>
            <div
              data-reveal
              className="relative aspect-[3/4] overflow-hidden bg-[#d2caba] [--reveal-delay:160ms]"
            >
              <Image
                src="/images/campaign/chaio-campaign-movement.webp"
                alt="Un vestido liviano en movimiento bajo la luz natural"
                fill
                sizes="(min-width: 768px) 19vw, 36vw"
                className="object-cover"
              />
            </div>
          </div>
        </div>
        <div className="max-w-lg py-2 md:py-12">
          <h2
            id="story-title"
            data-reveal
            className="font-heading text-[clamp(2.25rem,4vw,4rem)] leading-[1.1] font-normal tracking-[-0.035em]"
          >
            Vestirte también
            <br />
            es elegirte.
          </h2>
          <p
            data-reveal
            className="text-foreground mt-7 max-w-[390px] text-base leading-7 [--reveal-delay:80ms]"
          >
            Hay prendas que acompañan tu ritmo y otras que te invitan a cambiarlo. En CHAIOBOUTIQUE
            encontrás espacio para las dos.
          </p>
          <p
            data-reveal
            className="text-foreground mt-4 max-w-[390px] text-base leading-7 [--reveal-delay:140ms]"
          >
            Elegí a tu manera. Nosotras te acompañamos.
          </p>
          <Link
            data-reveal
            href="/catalog"
            className="editorial-link mt-8 inline-flex min-h-11 items-center gap-5 text-sm font-medium [--reveal-delay:200ms]"
          >
            Encontrá tu próximo favorito <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}
