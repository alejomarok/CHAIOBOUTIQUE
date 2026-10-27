import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/pos",
        "/account",
        "/api",
        "/order/",
        "/checkout",
        "/cart",
        "/recover-order",
        "/login",
        "/register",
        "/reset-password",
      ],
    },
    sitemap: `${env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/sitemap.xml`,
  };
}
