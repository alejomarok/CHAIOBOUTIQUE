import { prisma } from "@/lib/db-core";
import { recordAuditLog } from "@/modules/audit/index-core";

// Node-safe core: no "server-only" import, and imports db-core.ts/
// audit/index-core.ts (not the "server-only"-guarded wrappers) so this stays
// importable from a plain Node context (Playwright's test-runner process) —
// see src/modules/warehouses/service.ts and ARCHITECTURE.md.

export async function listWarehouses() {
  return prisma.warehouse.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
}

export async function getDefaultWarehouse() {
  return prisma.warehouse.findFirst({ where: { isDefault: true } });
}

export interface CreateWarehouseInput {
  code: string;
  name: string;
  description?: string | null;
}

// actorId is nullable — a system-initiated write (e.g. the default-warehouse
// seed in modules/warehouses/seed-core.ts) has no real acting user, same
// "system action, never attributed to a human that didn't perform it"
// posture as modules/attributes/service-core.ts's createSizeGroup.
export async function createWarehouse(input: CreateWarehouseInput, actorId: string | null) {
  const warehouse = await prisma.warehouse.create({
    data: { code: input.code, name: input.name, description: input.description ?? null },
  });

  await recordAuditLog({
    userId: actorId,
    action: "warehouse.created",
    entityType: "Warehouse",
    entityId: warehouse.id,
    newValue: { code: warehouse.code, name: warehouse.name },
  });

  return warehouse;
}

export interface UpdateWarehouseInput {
  name?: string;
  description?: string | null;
  isActive?: boolean;
}

export async function updateWarehouse(id: string, input: UpdateWarehouseInput, actorId: string) {
  const warehouse = await prisma.warehouse.update({ where: { id }, data: input });

  await recordAuditLog({
    userId: actorId,
    action: "warehouse.updated",
    entityType: "Warehouse",
    entityId: id,
    newValue: { ...input },
  });

  return warehouse;
}

// Exactly one default warehouse — unset the old one and set the new one in
// a single transaction. Belt-and-suspenders alongside the hand-written
// partial unique index on warehouse("isDefault") WHERE "isDefault" = true
// (see DATABASE.md).
// actorId is nullable for the same reason as createWarehouse above.
export async function setDefaultWarehouse(id: string, actorId: string | null) {
  const warehouse = await prisma.$transaction(async (tx) => {
    await tx.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    return tx.warehouse.update({ where: { id }, data: { isDefault: true } });
  });

  await recordAuditLog({
    userId: actorId,
    action: "warehouse.default_changed",
    entityType: "Warehouse",
    entityId: id,
  });

  return warehouse;
}
