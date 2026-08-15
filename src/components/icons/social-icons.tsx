// lucide-react deliberately ships no brand/logo icons (a licensing-driven
// omission across most icon libraries) — these are small, hand-drawn,
// intentionally simplified glyphs kept in the same 24x24 stroke style as
// the rest of the app's lucide icons, so they sit naturally next to them
// (same size props, same `currentColor` theming, same hover treatment).
// Not raster images, not a third-party asset fetch.
import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function baseProps(props: IconProps) {
  return {
    xmlns: "http://www.w3.org/2000/svg",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export function InstagramIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function FacebookIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M13.8 8.2h-1.6c-.9 0-1.4.5-1.4 1.4v1.6H13.8l-.3 2.3h-2.7V21" />
    </svg>
  );
}

export function TikTokIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M14 4v10.2a2.9 2.9 0 1 1-2.4-2.86" />
      <path d="M14 4a4.3 4.3 0 0 0 4.3 4.3V10a6 6 0 0 1-4.3-1.8" />
    </svg>
  );
}

export function WhatsAppIcon(props: IconProps) {
  return (
    <svg {...baseProps(props)}>
      <path d="M7 20l1.2-3.4A7.5 7.5 0 1 1 11.9 19L7 20Z" />
      <path d="M9.2 9.6c.2-.5.4-.5.6-.5h.5c.2 0 .4 0 .5.4.2.5.6 1.5.6 1.6.1.1.1.3 0 .4-.1.2-.2.3-.3.4l-.4.4c-.1.1-.2.3 0 .5.2.3.7 1.1 1.4 1.7.9.8 1.6 1 1.9 1.1.2.1.4.1.5-.1l.6-.7c.2-.2.3-.2.5-.1l1.4.7c.2.1.3.2.4.3 0 .2 0 .8-.3 1.2-.3.5-1.3 1-2 1-.6 0-2-.2-3.6-1.6-1.9-1.6-2.8-3.4-2.9-3.6-.1-.1-.7-1-.7-1.9 0-.9.5-1.4.6-1.6Z" />
    </svg>
  );
}
