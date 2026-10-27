import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";
import { isPubliclyVisible } from "@/modules/products/visibility";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const products = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    include: { variants: true },
  });
  return ["", "/catalog", "/terms", "/privacy", "/shipping", "/returns"]
    .map((path) => ({ url: `${base}${path}`, priority: path === "" ? 1 : 0.6 }))
    .concat(
      products
        .filter((product) => isPubliclyVisible(product, product.variants))
        .map((product) => ({
          url: `${base}/product/${encodeURIComponent(product.slug)}`,
          priority: 0.7,
        })),
    );
}
