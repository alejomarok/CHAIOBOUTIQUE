import { ArrowLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Logo } from "@/components/layout/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="storefront min-h-svh bg-[#f8f7f3] text-[#242b28] lg:grid lg:grid-cols-2">
      <aside className="relative hidden min-h-svh overflow-hidden bg-[#d9d4c7] lg:block">
        <Image
          src="/images/campaign/chaio-campaign-linen.webp"
          alt="Modelo con un conjunto de lino en tonos naturales de la campaña Chaio"
          fill
          loading="eager"
          fetchPriority="high"
          sizes="50vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-x-0 bottom-0 bg-[#242b28]/70 px-10 py-9 text-[#f8f7f3] xl:px-14">
          <p className="font-heading max-w-lg text-4xl leading-tight xl:text-5xl">
            Tu esencia, a tu manera.
          </p>
          <p className="mt-3 text-base leading-relaxed">
            Prendas para acompañarte en cada versión de vos.
          </p>
        </div>
      </aside>
      <div className="flex min-h-svh flex-col px-6 py-7 sm:px-10 lg:px-12 xl:px-20">
        <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-4">
          <Logo className="max-[390px]:gap-1 [&>span]:text-lg" />
          <Link
            href="/"
            className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-[#34483d] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#34483d]"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Volver a tienda
          </Link>
        </header>
        <main className="flex flex-1 items-center justify-center py-12 sm:py-16">
          <div className="w-full max-w-[400px] [&_form]:gap-5 [&_form>button]:min-h-12 [&_form>button]:rounded-none [&_form>button]:text-base [&_form>button]:font-medium [&_h1]:text-3xl [&_h1]:leading-tight [&_h1]:font-medium [&_input]:min-h-12 [&_input]:rounded-none [&_input]:bg-white [&_label]:text-sm">
            {children}
          </div>
        </main>
        <p className="text-center text-sm leading-relaxed text-[#505b53]">
          CHAIOBOUTIQUE · A tu manera, todos los días.
        </p>
      </div>
    </div>
  );
}
