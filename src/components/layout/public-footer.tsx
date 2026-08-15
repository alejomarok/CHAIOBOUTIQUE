import { Mail, MapPin } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/layout/logo";
import { FacebookIcon, InstagramIcon, TikTokIcon, WhatsAppIcon } from "@/components/icons/social-icons";
import { env } from "@/lib/env";

const STORE_LINKS = [
  { href: "/", label: "Inicio" },
  { href: "/catalog", label: "Catálogo" },
  { href: "/catalog?sort=newest", label: "Novedades" },
];

// None of these have a real page yet — shown as plain, deliberately
// non-clickable text rather than a link that would 404, per "either omit
// them or keep them clearly non-clickable until implemented."
const HELP_ITEMS = ["Contacto", "Envíos", "Cambios y devoluciones", "Preguntas frecuentes"];

function waLink(number: string): string {
  return `https://wa.me/${number.replace(/[^\d]/g, "")}`;
}

export function PublicFooter() {
  const socialLinks = [
    env.STORE_INSTAGRAM_URL && { href: env.STORE_INSTAGRAM_URL, label: "Instagram", Icon: InstagramIcon },
    env.STORE_FACEBOOK_URL && { href: env.STORE_FACEBOOK_URL, label: "Facebook", Icon: FacebookIcon },
    env.STORE_TIKTOK_URL && { href: env.STORE_TIKTOK_URL, label: "TikTok", Icon: TikTokIcon },
    env.STORE_WHATSAPP_NUMBER && {
      href: waLink(env.STORE_WHATSAPP_NUMBER),
      label: "WhatsApp",
      Icon: WhatsAppIcon,
    },
  ].filter((link): link is { href: string; label: string; Icon: typeof InstagramIcon } => Boolean(link));

  const hasContactInfo = Boolean(env.STORE_CONTACT_EMAIL || env.STORE_CITY);
  const hasFollowColumn = socialLinks.length > 0 || hasContactInfo;

  return (
    <footer className="border-border bg-muted/40 border-t">
      <div
        className={`mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:px-8 ${
          hasFollowColumn ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"
        }`}
      >
        <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-1">
          <Logo />
          <p className="text-muted-foreground max-w-xs text-sm text-pretty">
            Moda femenina con estilo, comodidad y personalidad.
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Tienda</h3>
          <ul className="mt-3 flex flex-col gap-2">
            {STORE_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-muted-foreground hover:text-foreground text-sm"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Ayuda</h3>
          <ul className="mt-3 flex flex-col gap-2">
            {HELP_ITEMS.map((item) => (
              <li key={item} className="text-muted-foreground text-sm">
                {item}
              </li>
            ))}
          </ul>
        </div>

        {hasFollowColumn && (
          <div>
            <h3 className="text-sm font-semibold">Seguinos</h3>
            {socialLinks.length > 0 && (
              <ul className="mt-3 flex items-center gap-2">
                {socialLinks.map(({ href, label, Icon }) => (
                  <li key={label}>
                    <Link
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={label}
                      className="text-muted-foreground hover:text-accent-cyan hover:bg-blush flex size-9 items-center justify-center rounded-full transition-colors"
                    >
                      <Icon className="size-[18px]" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {hasContactInfo && (
              <ul className="text-muted-foreground mt-4 flex flex-col gap-2 text-sm">
                {env.STORE_CONTACT_EMAIL && (
                  <li className="flex items-center gap-2">
                    <Mail className="size-4 shrink-0" aria-hidden="true" />
                    <Link href={`mailto:${env.STORE_CONTACT_EMAIL}`} className="hover:text-foreground">
                      {env.STORE_CONTACT_EMAIL}
                    </Link>
                  </li>
                )}
                {env.STORE_CITY && (
                  <li className="flex items-center gap-2">
                    <MapPin className="size-4 shrink-0" aria-hidden="true" />
                    <span>{env.STORE_CITY}</span>
                  </li>
                )}
              </ul>
            )}
          </div>
        )}
      </div>
      <div className="border-border border-t">
        <p className="text-muted-foreground mx-auto max-w-7xl px-4 py-6 text-xs sm:px-6 lg:px-8">
          &copy; {new Date().getFullYear()} CHAIOBOUTIQUE. Todos los derechos reservados.
        </p>
      </div>
    </footer>
  );
}
