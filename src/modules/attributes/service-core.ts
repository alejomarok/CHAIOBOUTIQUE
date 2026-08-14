import { prisma } from "@/lib/db-core";
import { slugify } from "@/lib/slug";
import { timed } from "@/lib/timing";
import { recordAuditLog } from "@/modules/audit/index-core";

// Node-safe core: no "server-only" import, and imports db-core.ts/
// audit/index-core.ts (not the "server-only"-guarded wrappers) so this stays
// importable from a plain Node context (Playwright's test-runner process) —
// see src/modules/attributes/service.ts and ARCHITECTURE.md.

// Size groups — see schema.prisma's SizeGroup comment for why sizes are
// scoped this way (the same displayed value means different things in
// different categories, e.g. pants "40" vs. footwear "40").
export async function listSizeGroups() {
  return prisma.sizeGroup.findMany({
    include: { _count: { select: { options: true, products: true } } },
    orderBy: [{ name: "asc" }],
  });
}

export async function getSizeGroupById(id: string) {
  return prisma.sizeGroup.findUnique({
    where: { id },
    include: {
      options: { orderBy: [{ sortOrder: "asc" }, { label: "asc" }] },
      _count: { select: { products: true } },
    },
  });
}

// SizeGroup is never hard-deleted while anything still depends on it —
// same "soft enforcement backed by an explicit check, not just the DB
// error" posture as everywhere else in this codebase. Two independent
// reasons a delete can be rejected:
//   - products currently use it (the actual business rule requested);
//   - it still has SizeOption rows (SizeOption.sizeGroup is
//     onDelete: Restrict, so the DB would reject the delete anyway — this
//     check exists purely to turn that into a clear message instead of a
//     raw FK-violation error).
export class SizeGroupInUseError extends Error {
  constructor() {
    super("No se puede eliminar el grupo: hay productos que lo usan.");
    this.name = "SizeGroupInUseError";
  }
}

export class SizeGroupHasOptionsError extends Error {
  constructor() {
    super("No se puede eliminar el grupo: todavía tiene talles. Eliminalos primero.");
    this.name = "SizeGroupHasOptionsError";
  }
}

export async function deleteSizeGroup(id: string, actorId: string): Promise<void> {
  const sizeGroup = await prisma.sizeGroup.findUniqueOrThrow({
    where: { id },
    include: { _count: { select: { products: true, options: true } } },
  });

  if (sizeGroup._count.products > 0) throw new SizeGroupInUseError();
  if (sizeGroup._count.options > 0) throw new SizeGroupHasOptionsError();

  await prisma.sizeGroup.delete({ where: { id } });

  await recordAuditLog({
    userId: actorId,
    action: "size_group.deleted",
    entityType: "SizeGroup",
    entityId: id,
    previousValue: { code: sizeGroup.code, name: sizeGroup.name },
  });
}

export interface CreateSizeGroupInput {
  code: string;
  name: string;
  description?: string | null;
}

// actorId is nullable — a system-initiated write (e.g. the reference-data
// seed in modules/attributes/seed-core.ts) has no real acting user, same
// "system action, never attributed to a human that didn't perform it"
// posture as modules/customers/service.ts's ensureCustomerRoleAssignment.
export async function createSizeGroup(input: CreateSizeGroupInput, actorId: string | null) {
  const sizeGroup = await prisma.sizeGroup.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: "size_group.created",
    entityType: "SizeGroup",
    entityId: sizeGroup.id,
    newValue: { code: sizeGroup.code, name: sizeGroup.name },
  });

  return sizeGroup;
}

export interface UpdateSizeGroupInput {
  name?: string;
  description?: string | null;
  isActive?: boolean;
}

export async function updateSizeGroup(id: string, input: UpdateSizeGroupInput, actorId: string) {
  const sizeGroup = await prisma.sizeGroup.update({ where: { id }, data: input });

  await recordAuditLog({
    userId: actorId,
    action: "size_group.updated",
    entityType: "SizeGroup",
    entityId: id,
    newValue: { ...input },
  });

  return sizeGroup;
}

// Size options within a group — always ordered by sortOrder, never
// alphabetically by label (a plain string sort would put "10" before "9").
// See required behavior #6 and tests/unit/attributes-service.test.ts.
export async function listSizeOptions(sizeGroupId: string) {
  return timed("attributes.listSizeOptions", () =>
    prisma.sizeOption.findMany({
      where: { sizeGroupId },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    }),
  );
}

export interface CreateSizeOptionInput {
  sizeGroupId: string;
  code: string;
  label: string;
  sortOrder?: number;
}

// actorId is nullable for the same reason as createSizeGroup above.
export async function createSizeOption(input: CreateSizeOptionInput, actorId: string | null) {
  const sizeOption = await prisma.sizeOption.create({
    data: {
      sizeGroupId: input.sizeGroupId,
      code: input.code,
      label: input.label,
      // Normalized via the project's one normalization policy (lib/slug.ts)
      // so "40"/" 40 "/accented near-duplicates collide within the same
      // group at the DB level — see @@unique([sizeGroupId, normalizedLabel])
      // on SizeOption.
      normalizedLabel: slugify(input.label),
      sortOrder: input.sortOrder ?? 0,
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: "size_option.created",
    entityType: "SizeOption",
    entityId: sizeOption.id,
    newValue: {
      sizeGroupId: sizeOption.sizeGroupId,
      code: sizeOption.code,
      label: sizeOption.label,
    },
  });

  return sizeOption;
}

export interface UpdateSizeOptionInput {
  code?: string;
  label?: string;
  sortOrder?: number;
  isActive?: boolean;
}

export async function updateSizeOption(id: string, input: UpdateSizeOptionInput, actorId: string) {
  const sizeOption = await prisma.sizeOption.update({
    where: { id },
    data: {
      ...(input.code !== undefined ? { code: input.code } : {}),
      ...(input.label !== undefined
        ? { label: input.label, normalizedLabel: slugify(input.label) }
        : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  await recordAuditLog({
    userId: actorId,
    action: "size_option.updated",
    entityType: "SizeOption",
    entityId: id,
    newValue: { ...input },
  });

  return sizeOption;
}

export async function listColors() {
  return timed("attributes.listColors", () =>
    prisma.color.findMany({ orderBy: [{ displayOrder: "asc" }, { displayName: "asc" }] }),
  );
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
