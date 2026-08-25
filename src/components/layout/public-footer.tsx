import { Mail, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import {
  FacebookIcon,
  InstagramIcon,
  WhatsAppIcon,
} from "@/components/icons/social-icons";
import { Logo } from "@/components/layout/logo";
import { isSchemaDriftError } from "@/lib/prisma-schema-drift";
import { normalizePhone } from "@/modules/customers/normalize";
import { listActiveBranches } from "@/modules/store-branches/branch";
import { getStoreConfiguration } from "@/modules/store-settings/service";
import type { StoreBranch } from "@/generated/prisma/client";

const NAV_LINKS = [
  { href: "/catalog?sort=newest", label: "Nueva Colección" },
  { href: "/catalog", label: "Tops" },
  { href: "/catalog", label: "Vestidos" },
  { href: "/catalog", label: "Pantalones" },
  { href: "/catalog", label: "Ventas Especiales" },
];

const INFO_ITEMS = [
  "Nosotras",
  "Guía de Talles",
  "Preguntas Frecuentes",
  "Contacto",
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
}

const EMPTY_CONTACT_CONFIG: FooterContactConfig = {
  publicPhone: null,
  publicEmail: null,
  whatsappPhone: null,
  instagramUrl: null,
  facebookUrl: null,
};

async function loadFooterData(): Promise<{
  config: FooterContactConfig;
  branches: StoreBranch[];
}> {
  try {
    const [config, branches] = await Promise.all([
      getStoreConfiguration(),
      listActiveBranches(),
    ]);

    return {
      config: {
        publicPhone: config.publicPhone,
        publicEmail: config.publicEmail,
        whatsappPhone: config.whatsappPhone,
        instagramUrl: config.instagramUrl,
        facebookUrl: config.facebookUrl,
      },
      branches,
    };
  } catch (error) {
    if (isSchemaDriftError(error)) {
      return { config: EMPTY_CONTACT_CONFIG, branches: [] };
    }
    throw error;
  }
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div>
      <h3 className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#4d443f] sm:text-xs">
        {children}
      </h3>
      <span className="mt-3 block h-px w-6 bg-[#d7ad78]" aria-hidden="true" />
    </div>
  );
}

function BotanicalDecoration() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 180 250"
      className="pointer-events-none absolute -bottom-5 right-0 hidden h-56 w-40 text-[#dfc4a5]/55 xl:block"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
    >
      <path d="M166 243C139 205 115 168 105 126C96 88 105 43 125 7" />
      <path d="M121 29C136 31 147 41 151 56C136 54 124 44 121 29Z" />
      <path d="M108 60C91 60 77 69 70 83C87 84 101 75 108 60Z" />
      <path d="M111 93C129 94 142 104 148 120C130 119 117 109 111 93Z" />
      <path d="M104 124C86 125 72 136 66 152C84 151 98 141 104 124Z" />
      <path d="M115 155C133 156 147 167 153 184C134 182 121 172 115 155Z" />
      <path d="M126 186C108 188 95 199 90 216C108 214 121 203 126 186Z" />
    </svg>
  );
}

export async function PublicFooter() {
  const { config, branches } = await loadFooterData();

  const socialLinks = [
    {
      href: config.instagramUrl,
      label: "Instagram",
      Icon: InstagramIcon,
    },
    {
      href: config.facebookUrl,
      label: "Facebook",
      Icon: FacebookIcon,
    },
    {
      href: config.whatsappPhone ? waLink(config.whatsappPhone) : null,
      label: "WhatsApp",
      Icon: WhatsAppIcon,
    },
  ];

  return (
    <footer className="relative overflow-hidden border-t border-[#ead8c6] bg-[#fffaf5] text-[#504844]">
      <BotanicalDecoration />

      <div className="relative mx-auto max-w-[1260px] px-5 pb-9 pt-10 sm:px-8 sm:pt-12 lg:px-10 lg:pb-10 lg:pt-11">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.08fr_0.82fr_1fr_1.18fr] lg:gap-12">
          <section>
            <div className="max-w-[245px]">
              <Logo />
            </div>

            <p className="mt-5 max-w-[270px] text-[12px] leading-5 text-[#6f6661]">
              Moda femenina seleccionada con amor, para acompañarte en tu mejor versión,
              todos los días.
            </p>
          </section>

          <section>
            <SectionTitle>Navegación</SectionTitle>

            <ul className="mt-5 space-y-2.5">
              {NAV_LINKS.map((item, index) => (
                <li key={`${item.label}-${index}`}>
                  <Link
                    href={item.href}
                    className="text-[12px] text-[#5f5752] transition-colors hover:text-[#159aa0]"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}

              {INFO_ITEMS.map((item) => (
                <li key={item}>
                  <span className="text-[12px] text-[#5f5752]">{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <SectionTitle>Nuestras sucursales</SectionTitle>

            {branches.length > 0 ? (
              <ul className="mt-5 space-y-6">
                {branches.slice(0, 2).map((branch, index) => (
                  <li key={branch.id}>
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f7e3dc] text-[#a76d5b]">
                        <MapPin className="size-4" aria-hidden="true" />
                      </span>

                      <div className="pt-0.5">
                        <p className="text-[12px] leading-5 text-[#5b524d]">
                          {branch.address},
                        </p>
                        <p className="text-[12px] leading-5 text-[#5b524d]">
                          {[branch.city, branch.province].filter(Boolean).join(" ")}
                        </p>
                      </div>
                    </div>

                    {index === 0 && (
                      <div
                        aria-hidden="true"
                        className="ml-[52px] mt-5 h-px w-36 bg-[#e4bf95]"
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-5 space-y-6">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f7e3dc] text-[#a76d5b]">
                    <MapPin className="size-4" aria-hidden="true" />
                  </span>
                  <div className="pt-0.5 text-[12px] leading-5 text-[#5b524d]">
                    <p>Libertad 161,</p>
                    <p>Río Tercero (Córdoba)</p>
                  </div>
                </div>

                <div aria-hidden="true" className="ml-[52px] h-px w-36 bg-[#e4bf95]" />

                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-[#f7e3dc] text-[#a76d5b]">
                    <MapPin className="size-4" aria-hidden="true" />
                  </span>
                  <div className="pt-0.5 text-[12px] leading-5 text-[#5b524d]">
                    <p>Av. Pistarini 141,</p>
                    <p>Embalse</p>
                  </div>
                </div>
              </div>
            )}
          </section>

          <section className="lg:pl-2">
            <SectionTitle>Contactanos</SectionTitle>

            <div className="mt-5 max-w-[285px] space-y-3">
              {config.whatsappPhone && (
                <Link
                  href={waLink(config.whatsappPhone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`WhatsApp: ${config.whatsappPhone}`}
                  className="flex items-center gap-3 rounded-xl border border-[#f1ddd5] bg-[#fff7f2] px-4 py-3 transition-colors hover:bg-white"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#d8a96e] bg-white text-[#b57c49]">
                    <WhatsAppIcon className="size-[17px]" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[#574e49]">
                      {config.whatsappPhone}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[#756b65]">
                      ¡Escribinos, estamos para ayudarte!
                    </span>
                  </span>
                </Link>
              )}

              {config.publicPhone && (
                <Link
                  href={telHref(config.publicPhone)}
                  className="flex items-center gap-3 rounded-xl border border-[#f1ddd5] bg-[#fff7f2] px-4 py-3 transition-colors hover:bg-white"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#d8a96e] bg-white text-[#b57c49]">
                    <Phone className="size-[17px]" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-medium text-[#574e49]">
                      {config.publicPhone}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[#756b65]">Llamanos</span>
                  </span>
                </Link>
              )}

              {config.publicEmail && (
                <Link
                  href={`mailto:${config.publicEmail}`}
                  className="flex items-center gap-3 rounded-xl border border-[#f1ddd5] bg-[#fff7f2] px-4 py-3 transition-colors hover:bg-white"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-[#d8a96e] bg-white text-[#b57c49]">
                    <Mail className="size-[17px]" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-[#574e49]">
                      {config.publicEmail}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-[#756b65]">Correo electrónico</span>
                  </span>
                </Link>
              )}

              {!config.whatsappPhone && !config.publicPhone && !config.publicEmail && (
                <div className="rounded-xl border border-dashed border-[#ead4c9] bg-white/40 px-4 py-4">
                  <p className="text-[11px] leading-5 text-[#8f837d]">
                    Los datos de contacto aparecerán acá cuando los configures desde el panel.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-7">
              <div className="lg:text-center">
                <SectionTitle>Seguinos</SectionTitle>
              </div>

              <ul className="mt-5 grid max-w-[270px] grid-cols-3 gap-3">
                {socialLinks.map(({ href, label, Icon }) => (
                  <li key={label} className="min-w-0">
                    {href ? (
                      <Link
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={label}
                        className="group flex flex-col items-center gap-2 text-[10px] text-[#665c56]"
                      >
                        <span className="flex size-11 items-center justify-center rounded-full bg-[#f5dfd8] text-[#302b29] transition duration-200 group-hover:-translate-y-0.5 group-hover:bg-[#efd0c8]">
                          <Icon className="size-[19px]" />
                        </span>
                        <span className="truncate">{label}</span>
                      </Link>
                    ) : (
                      <div
                        aria-label={`${label} no configurado`}
                        className="flex flex-col items-center gap-2 text-[10px] text-[#9a8f89]"
                      >
                        <span className="flex size-11 items-center justify-center rounded-full bg-[#f7e9e4] text-[#6c625d]">
                          <Icon className="size-[19px]" />
                        </span>
                        <span className="truncate">{label}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
      </div>

      <div
        aria-hidden="true"
        className="h-[2px] w-full bg-[linear-gradient(90deg,#ff2f86_0%,#ff2f86_18%,#16c7e9_18%,#16c7e9_39%,#76d10b_39%,#76d10b_61%,#ffd41b_61%,#ffd41b_79%,#ff8a00_79%,#ff8a00_100%)]"
      />

      <div className="relative border-t border-[#f3e9e3] bg-[#fffdfb]">
        <div className="mx-auto grid max-w-[1260px] gap-4 px-5 py-5 text-[10px] text-[#716762] sm:px-8 lg:grid-cols-[1fr_auto_1fr] lg:items-center lg:px-10">
          <p>
            &copy; {new Date().getFullYear()} CHAIOBOUTIQUE. Todos los derechos reservados.
          </p>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 lg:justify-center">
            <span>Términos y Condiciones</span>
            <span className="hidden text-[#9a918c] sm:inline">|</span>
            <span>Cambios y Devoluciones</span>
            <span className="hidden text-[#9a918c] sm:inline">|</span>
            <span>Política de Privacidad</span>
          </div>

          <p className="flex items-center gap-2 lg:justify-end">
            Diseñado con <span className="text-[#d39a58]">♡</span> para vos.
          </p>
        </div>
      </div>
    </footer>
  );
}