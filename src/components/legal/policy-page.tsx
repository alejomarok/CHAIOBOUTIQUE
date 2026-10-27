import { randomUUID } from "node:crypto";
import Link from "next/link";
import { getStoreConfiguration } from "@/modules/store-settings/service";
import { POLICIES, POLICY_DATE, POLICY_LINKS } from "@/modules/legal/policies";
import { ConsumerRequestForm } from "./consumer-request-form";

export async function PolicyPage({ policy }: { policy: keyof typeof POLICIES }) {
  const content = POLICIES[policy];
  const store = await getStoreConfiguration();
  const phone = store.whatsappPhone ?? "+5493571319469";
  return (
    <article className="mx-auto max-w-4xl px-6 py-14 sm:px-10 sm:py-20">
      <h1 className="font-heading text-4xl leading-tight sm:text-5xl">{content.title}</h1>
      <p className="mt-5 max-w-2xl text-lg leading-8">{content.intro}</p>
      <p className="text-muted-foreground mt-4 text-sm">Vigente desde el {POLICY_DATE}.</p>
      <nav aria-label="Políticas de la tienda" className="my-9 flex flex-wrap gap-x-6 gap-y-1">
        {POLICY_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="inline-flex min-h-11 items-center text-sm underline underline-offset-4"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="space-y-9">
        {content.sections.map((section) => (
          <section key={section.title}>
            <h2 className="font-heading text-2xl sm:text-3xl">{section.title}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph.slice(0, 45)} className="mt-4 text-base leading-8">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
      <section className="bg-muted my-10 p-6 sm:p-8">
        <h2 className="font-heading text-2xl">Responsable y contacto</h2>
        <p className="mt-4 leading-7">
          {store.fiscalLegalName ?? "Silvina Ivana Dani"} · CHAIOBOUTIQUE
        </p>
        {store.fiscalTaxId && <p className="leading-7">CUIT: {store.fiscalTaxId}</p>}
        <p className="leading-7">Av. Pistarini 141, Embalse, Córdoba, Argentina.</p>
        <a
          href={`https://wa.me/${phone.replace(/\D/g, "")}`}
          className="inline-flex min-h-11 items-center underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          WhatsApp: +54 9 3571 31-9469
        </a>
        {store.publicEmail && (
          <p>
            <a
              className="inline-flex min-h-11 items-center underline"
              href={`mailto:${store.publicEmail}`}
            >
              {store.publicEmail}
            </a>
          </p>
        )}
      </section>
      {content.form && (
        <section aria-labelledby="request-title" className="my-10">
          <h2 id="request-title" className="font-heading mb-6 text-3xl">
            {policy === "privacy" ? "Ejercé tus derechos" : "Registrá tu solicitud"}
          </h2>
          <ConsumerRequestForm kind={content.form} requestId={randomUUID()} />
        </section>
      )}
      <p className="mt-10 text-sm leading-7">
        Referencias:{" "}
        <a
          className="underline"
          href="https://www.argentina.gob.ar/normativa/nacional/638/actualizacion"
          target="_blank"
          rel="noopener noreferrer"
        >
          Ley de Defensa del Consumidor
        </a>{" "}
        y{" "}
        <a
          className="underline"
          href="https://www.argentina.gob.ar/aaip/datospersonales/derechos"
          target="_blank"
          rel="noopener noreferrer"
        >
          derechos sobre datos personales
        </a>
        .
      </p>
    </article>
  );
}
