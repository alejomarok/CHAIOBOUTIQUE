import "server-only";

import { prisma } from "@/lib/db";
import { recordAuditLog } from "@/modules/audit";

export async function listSizes() {
  return prisma.size.findMany({ orderBy: [{ displayOrder: "asc" }, { displayName: "asc" }] });
}

export interface CreateSizeInput {
  key: string;
  displayName: string;
  description?: string | null;
  displayOrder?: number;
  group?: string | null;
}

export async function createSize(input: CreateSizeInput, actorId: string) {
  const size = await prisma.size.create({
    data: {
      key: input.key,
      displayName: input.displayName,
      description: input.description ?? null,
      displayOrder: input.displayOrder ?? 0,
      group: input.group ?? null,
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: "size.created",
    entityType: "Size",
    entityId: size.id,
    newValue: { key: size.key, displayName: size.displayName },
  });

  return size;
}

export interface UpdateSizeInput {
  displayName?: string;
  description?: string | null;
  displayOrder?: number;
  group?: string | null;
  isActive?: boolean;
}

export async function updateSize(id: string, input: UpdateSizeInput, actorId: string) {
  const size = await prisma.size.update({ where: { id }, data: input });

  await recordAuditLog({
    userId: actorId,
    action: "size.updated",
    entityType: "Size",
    entityId: id,
    newValue: { ...input },
  });

  return size;
}

export async function listColors() {
  return prisma.color.findMany({ orderBy: [{ displayOrder: "asc" }, { displayName: "asc" }] });
}

export interface CreateColorInput {
  key: string;
  displayName: string;
  hexPrimary?: string | null;
  hexSecondary?: string | null;
  displayOrder?: number;
}

export async function createColor(input: CreateColorInput, actorId: string) {
  const color = await prisma.color.create({
    data: {
      key: input.key,
      displayName: input.displayName,
      hexPrimary: input.hexPrimary ?? null,
      hexSecondary: input.hexSecondary ?? null,
      displayOrder: input.displayOrder ?? 0,
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: "color.created",
    entityType: "Color",
    entityId: color.id,
    newValue: { key: color.key, displayName: color.displayName },
  });

  return color;
}

export interface UpdateColorInput {
  displayName?: string;
  hexPrimary?: string | null;
  hexSecondary?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}

export async function updateColor(id: string, input: UpdateColorInput, actorId: string) {
  const color = await prisma.color.update({ where: { id }, data: input });

  await recordAuditLog({
    userId: actorId,
    action: "color.updated",
    entityType: "Color",
    entityId: id,
    newValue: { ...input },
  });

  return color;
}
