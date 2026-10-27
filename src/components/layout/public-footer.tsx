import { Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { POLICY_LINKS } from "@/modules/legal/policies";

import {
  FacebookIcon,
  InstagramIcon,
  TikTokIcon,
  WhatsAppIcon,
} from "@/components/icons/social-icons";
import { Logo } from "@/components/layout/logo";
import type { StoreBranch } from "@/generated/prisma/client";
import { isSchemaDriftError } from "@/lib/prisma-schema-drift";
import { normalizePhone } from "@/modules/customers/normalize";
import { listActiveBranches } from "@/modules/store-branches/branch";
import { getStoreConfiguration } from "@/modules/store-settings/service";

const NAV_LINKS = [
  { href: "/catalog", label: "Ver colección" },
  { href: "/catalog?sort=newest", label: "Novedades" },
  { href: "/#esencia", label: "Nuestra esencia" },
  { href: "/#contacto", label: "Contacto" },
];

function waLink(rawNumber: string): string {
  const digits = normalizePhone(rawNumber)?.replace(/^\+/, "") ?? "";
  return `https://wa.me/${digits}`;
}

function telHref(rawNumber: string): string {
  return `tel:${normalizePhone(rawNumber) ?? rawNumber}`;
}

interface FooterContactConfig {
  publicPhone: string | null;
  publicEmail: string | null;
  whatsappPhone: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
}

const EMPTY_CONTACT_CONFIG: FooterContactConfig = {
  publicPhone: null,
  publicEmail: null,
  whatsappPhone: null,
  instagramUrl: null,
  facebookUrl: null,
  tiktokUrl: null,
};

async function loadFooterData(): Promise<{ config: FooterContactConfig; branches: StoreBranch[] }> {
  try {
    const [config, branches] = await Promise.all([getStoreConfiguration(), listActiveBranches()]);
    return {
      config: {
        publicPhone: config.publicPhone,
        publicEmail: config.publicEmail,
        whatsappPhone: config.whatsappPhone,
        instagramUrl: config.instagramUrl,
        facebookUrl: config.facebookUrl,
        tiktokUrl: config.tiktokUrl,
      },
      branches,
    };
  } catch (error) {
    if (isSchemaDriftError(error)) return { config: EMPTY_CONTACT_CONFIG, branches: [] };
    throw error;
  }
}

const linkClassName =
  "inline-flex min-h-11 items-center text-base leading-relaxed transition-colors hover:text-[#34483d] hover:underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#34483d]";

export async function PublicFooter() {
  const { config, branches } = await loadFooterData();
  const socialLinks = [
    { href: config.instagramUrl, label: "Instagram", Icon: InstagramIcon },
    { href: config.facebookUrl, label: "Facebook", Icon: FacebookIcon },
    {
      href: config.whatsappPhone ? waLink(config.whatsappPhone) : null,
      label: "WhatsApp",
      Icon: WhatsAppIcon,
    },
    ...(config.tiktokUrl ? [{ href: config.tiktokUrl, label: "TikTok", Icon: TikTokIcon }] : []),
  ];
  const hasContact = config.whatsappPhone || config.publicPhone || config.publicEmail;

  return (
    <footer id="contacto" className="scroll-mt-44 bg-[#eeeee7] text-[#242b28]">
      <div className="mx-auto max-w-[1440px] px-6 py-14 sm:px-10 lg:px-16 lg:py-20">
        <div className="grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-[1.3fr_0.8fr_1fr_1.1fr]">
          <div>
            <Logo />
            <p className="mt-6 max-w-[280px] text-base leading-relaxed">
              Prendas que se sienten como vos. Una selección para acompañarte a tu manera.
            </p>
            <nav aria-label="Redes sociales" className="mt-6">
              <h2 className="font-sans text-sm font-medium">Seguinos</h2>
              <ul className="mt-3 flex flex-wrap gap-3">
                {socialLinks.map(({ href, label, Icon }) => (
                  <li key={label}>
                    {href ? (
                      <Link
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={label}
                        title={label}
                        className="flex size-11 items-center justify-center rounded-full bg-[#e1e4db] text-[#34483d] transition-colors hover:bg-[#34483d] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#34483d]"
                      >
                        <Icon className="size-5" />
                      </Link>
                    ) : (
                      <span
                        role="img"
                        aria-label={`${label}, próximamente`}
                        title={`${label} · próximamente`}
                        className="flex size-11 items-center justify-center rounded-full bg-[#e1e4db] text-[#34483d]/60"
                      >
                        <Icon className="size-5" />
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <nav aria-label="Navegación del pie de página">
            <h2 className="text-base font-semibold">Explorá Chaio</h2>
            <ul className="mt-4">
              {NAV_LINKS.map(({ href, label }) => (
                <li key={href}>
                  <Link href={href} className={linkClassName}>
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <section aria-labelledby="footer-stores">
            <h2 id="footer-stores" className="text-base font-semibold">
              Encontranos
            </h2>
            {branches.length > 0 ? (
              <ul className="mt-6 space-y-6">
                {branches.map((branch) => (
                  <li key={branch.id} className="flex items-start gap-3">
                    <MapPin className="mt-1 size-4 shrink-0 text-[#34483d]" aria-hidden="true" />
                    <div className="text-base leading-relaxed">
                      <p className="font-medium">{branch.name}</p>
                      <address className="mt-1 not-italic">
                        {branch.address}
                        <br />
                        {[branch.city, branch.province].filter(Boolean).join(", ")}
                      </address>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-6 text-base leading-relaxed">
                Nuestra colección te espera en la tienda online, estés donde estés.
              </p>
            )}
          </section>

          <section aria-labelledby="footer-contact">
            <h2 id="footer-contact" className="text-base font-semibold">
              Hablemos
            </h2>
            {hasContact ? (
              <ul className="mt-4 space-y-1">
                {config.whatsappPhone && (
                  <li>
                    <Link
                      href={waLink(config.whatsappPhone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={linkClassName}
                    >
                      <WhatsAppIcon className="mr-3 size-4 shrink-0" />
                      <span>Escribinos por WhatsApp</span>
                    </Link>
                  </li>
                )}
                {config.publicPhone && (
                  <li>
                    <Link href={telHref(config.publicPhone)} className={linkClassName}>
                      <Phone className="mr-3 size-4 shrink-0" aria-hidden="true" />
                      <span>{config.publicPhone}</span>
                    </Link>
                  </li>
                )}
                {config.publicEmail && (
                  <li>
                    <Link
                      href={`mailto:${config.publicEmail}`}
                      className={`${linkClassName} break-all`}
                    >
                      <Mail className="mr-3 size-4 shrink-0" aria-hidden="true" />
                      <span>{config.publicEmail}</span>
                    </Link>
                  </li>
                )}
              </ul>
            ) : (
              <div className="mt-6">
                <p className="text-base leading-relaxed">
                  Encontrá tu próximo favorito y descubrí todo lo nuevo en Chaio.
                </p>
                <Link href="/catalog" className={`${linkClassName} mt-2 font-medium`}>
                  Conocé la colección
                </Link>
              </div>
            )}
          </section>
        </div>

        <nav
          aria-label="Información legal y ayuda"
          className="mt-12 flex flex-wrap gap-x-7 gap-y-1 text-sm"
        >
          {POLICY_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-11 items-center underline underline-offset-4"
            >
              {link.label}
            </Link>
          ))}
          <Link
            href="/recover-order"
            className="inline-flex min-h-11 items-center underline underline-offset-4"
          >
            Recuperar mi pedido
          </Link>
        </nav>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 text-sm leading-relaxed text-[#505b53]">
          <p>&copy; {new Date().getFullYear()} CHAIOBOUTIQUE.</p>
          <p>Hecho para que seas vos.</p>
        </div>
      </div>
    </footer>
  );
}
