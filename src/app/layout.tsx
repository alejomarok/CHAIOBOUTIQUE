import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";
import { env } from "@/lib/env";

import "./globals.css";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfairDisplay = Playfair_Display({
  variable: "--font-serif-display",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(env.NEXT_PUBLIC_APP_URL),
  title: {
    default: env.STORE_NAME,
    template: `%s — ${env.STORE_NAME}`,
  },
  description:
    "Moda femenina en Embalse, Córdoba. Elegí tus prendas en CHAIOBOUTIQUE y comprá online con retiro en el local.",
  openGraph: {
    type: "website",
    locale: "es_AR",
    siteName: "CHAIOBOUTIQUE",
    title: "CHAIOBOUTIQUE · Moda femenina",
    description:
      "Prendas para vestir tu propia historia. Descubrí nuestra selección de moda femenina.",
    images: [
      {
        url: "/images/campaign/chaio-campaign-hero.webp",
        width: 1536,
        height: 1024,
        alt: "Campaña editorial de CHAIOBOUTIQUE",
      },
    ],
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonced framework scripts require a fresh, dynamically rendered document.
  await headers();
  return (
    <html
      lang="es"
      data-scroll-behavior="smooth"
      className={`${geistSans.variable} ${geistMono.variable} ${playfairDisplay.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
