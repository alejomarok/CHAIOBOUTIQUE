import "server-only";

import { prisma } from "@/lib/db";
import { ensureUniqueSlug } from "@/lib/slug";
import { recordAuditLog } from "@/modules/audit";

export async function listBrands() {
  return prisma.brand.findMany({
    include: { _count: { select: { products: true } } },
    orderBy: { name: "asc" },
  });
}

export async function getBrandById(id: string) {
  return prisma.brand.findUnique({ where: { id } });
}

export interface CreateBrandInput {
  name: string;
  description?: string | null;
}

export async function createBrand(input: CreateBrandInput, actorId: string) {
  const slug = await ensureUniqueSlug(
    input.name,
    async (candidate) => (await prisma.brand.count({ where: { slug: candidate } })) > 0,
  );

  const brand = await prisma.brand.create({
    data: { name: input.name, slug, description: input.description ?? null },
  });

  await recordAuditLog({
    userId: actorId,
    action: "brand.created",
    entityType: "Brand",
    entityId: brand.id,
    newValue: { name: brand.name, slug: brand.slug },
  });

  return brand;
}

export interface UpdateBrandInput {
  name?: string;
  description?: string | null;
  isActive?: boolean;
}

export async function updateBrand(id: string, input: UpdateBrandInput, actorId: string) {
  const before = await prisma.brand.findUniqueOrThrow({ where: { id } });
  const brand = await prisma.brand.update({ where: { id }, data: input });

  await recordAuditLog({
    userId: actorId,
    action: "brand.updated",
    entityType: "Brand",
    entityId: id,
    previousValue: { name: before.name, isActive: before.isActive },
    newValue: { name: brand.name, isActive: brand.isActive },
  });

  return brand;
}
